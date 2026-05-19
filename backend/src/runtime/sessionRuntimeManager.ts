import { OpenF1Client } from '../data/openf1Client';
import { SnapshotStore } from '../data/snapshotStore';
import { F1SignalRClient } from '../data/f1SignalRClient';
import type {
  OpenF1Interval,
  OpenF1Lap,
  OpenF1Pit,
  OpenF1Position,
  OpenF1RaceControl,
  OpenF1Session,
  RaceSnapshot,
  SessionMode,
} from '../types';
import { buildReplayTimeline, type ReplayEvent } from './replayTimeline';

const REPLAY_SPEED = 10;

interface RuntimeCallbacks {
  onSnapshotUpdate: (snapshot: RaceSnapshot, lobbyIds: Set<string>) => void;
  onLapComplete: (snapshot: RaceSnapshot, lobbyIds: Set<string>) => Promise<void>;
  onFeedStall: (stalled: boolean, lobbyIds: Set<string>) => void;
  onReplayComplete: (snapshot: RaceSnapshot | null, lobbyIds: Set<string>) => Promise<void>;
  onError: (error: Error) => void;
}

export interface SessionRuntime {
  sessionId: string;
  mode: SessionMode;
  replaySpeed: number | null;
  addLobby(lobbyId: string): void;
  removeLobby(lobbyId: string): void;
  getLobbyIds(): Set<string>;
  getCurrentSnapshot(): RaceSnapshot | null;
  getPreviousSnapshot(): RaceSnapshot | null;
  start(): Promise<void>;
  stop(): void;
  pause?(): void;
  resume?(): void;
  isPausedState?(): boolean;
}

function cloneLobbyIds(source: Set<string>): Set<string> {
  return new Set(source);
}

abstract class BaseRuntime implements SessionRuntime {
  readonly sessionId: string;
  readonly mode: SessionMode;
  readonly replaySpeed: number | null;
  protected readonly session: OpenF1Session;
  protected readonly callbacks: RuntimeCallbacks;
  protected readonly lobbyIds = new Set<string>();
  protected readonly client: OpenF1Client;
  protected readonly snapshotStore: SnapshotStore;
  protected started = false;

  constructor(session: OpenF1Session, mode: SessionMode, replaySpeed: number | null, callbacks: RuntimeCallbacks) {
    this.session = session;
    this.sessionId = String(session.session_key);
    this.mode = mode;
    this.replaySpeed = replaySpeed;
    this.callbacks = callbacks;

    this.client = new OpenF1Client({
      onLapCompletion: (lap) => this.handleLapCompletion(lap),
      onPositionUpdate: (positions) => this.snapshotStore.processPositionUpdate(positions),
      onIntervalUpdate: (intervals) => this.snapshotStore.processIntervalUpdate(intervals),
      onPitUpdate: (pits) => this.snapshotStore.processPitUpdate(pits),
      onStintUpdate: (stints) => this.snapshotStore.processStintUpdate(stints),
      onRaceControlUpdate: (messages) => this.snapshotStore.processRaceControlUpdate(messages),
      onFeedStall: (stalled) => {
        this.snapshotStore.handleFeedStall(stalled);
        this.callbacks.onFeedStall(stalled, cloneLobbyIds(this.lobbyIds));
      },
      onError: (error) => this.callbacks.onError(error),
    });

    this.snapshotStore = new SnapshotStore(this.client, {
      onSnapshotUpdate: (snapshot) => {
        this.callbacks.onSnapshotUpdate(snapshot, cloneLobbyIds(this.lobbyIds));
      },
      onLapComplete: async (snapshot) => {
        await this.callbacks.onLapComplete(snapshot, cloneLobbyIds(this.lobbyIds));
      },
    });
  }

  addLobby(lobbyId: string): void {
    this.lobbyIds.add(lobbyId);
  }

  removeLobby(lobbyId: string): void {
    this.lobbyIds.delete(lobbyId);
    if (this.lobbyIds.size === 0) {
      this.stop();
    }
  }

  getLobbyIds(): Set<string> {
    return cloneLobbyIds(this.lobbyIds);
  }

  getCurrentSnapshot(): RaceSnapshot | null {
    return this.snapshotStore.getCurrentSnapshot();
  }

  getPreviousSnapshot(): RaceSnapshot | null {
    return this.snapshotStore.getPreviousSnapshot();
  }

  protected async handleLapCompletion(lap: OpenF1Lap): Promise<void> {
    this.snapshotStore.processLapCompletion(lap);
  }

  abstract start(): Promise<void>;
  abstract stop(): void;
}

class LiveSessionRuntime extends BaseRuntime {
  private signalRClient: F1SignalRClient | null = null;
  private isUsingFallback = false;

  constructor(session: OpenF1Session, callbacks: RuntimeCallbacks) {
    super(session, 'live', null, callbacks);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    // 1. Initialize the shared snapshot store cache
    this.client.setSession(this.session.session_key);
    await this.snapshotStore.initialize(this.session.session_key, {
      sessionMode: 'live',
      replaySpeed: null,
    });

    console.log(`[Live Runtime] Booting real-time streaming pipeline for session: ${this.sessionId}`);

    // 2. Spin up the real-time SignalR feed
    this.signalRClient = new F1SignalRClient({
      onPositionUpdate: (positions) => {
        if (!this.isUsingFallback) this.snapshotStore.processPositionUpdate(positions);
      },
      onLapCompletion: (lap) => {
        if (!this.isUsingFallback) this.snapshotStore.processLapCompletion(lap);
      },
      onConnectionLoss: () => {
        console.warn(`[Live Runtime] SignalR connection unstable for session ${this.sessionId}. Monitoring...`);
      },
      onConnectionRestored: () => {
        console.log(`[Live Runtime] SignalR connection fully restored for session ${this.sessionId}.`);
      },
      onConnectionClosedPermanently: () => {
        console.error(`[Live Runtime] SignalR closed permanently. Triggering REST emergency fallback.`);
        this.activateRESTFallback();
      }
    });

    try {
      // 3. Kick off the connection
      await this.signalRClient.start();
      console.log("[Live Runtime] Primary SignalR connection established successfully.");

      // TEST SIMULATION SHORT-CIRCUIT FOR SCENARIO B:
      // (Uncomment the block below when you want to test mid-race crash-protection handling)
      /*
      setTimeout(() => {
        console.log("\n [Test Sim] Triggering sudden simulated WebSocket connection drop...");
        (this.signalRClient as any).options.onConnectionClosedPermanently?.();
      }, 7000);
      */

    } catch (error: any) {
      console.error(`[Live Runtime] SignalR handshake failed. Instantly dropping back to REST polling:`, error.message);
      this.activateRESTFallback();
    }
  }

  private activateRESTFallback(): void {
    if (this.isUsingFallback) return;
    this.isUsingFallback = true;

    console.log(`[Fallback Engine] Initializing original OpenF1 REST polling client for session ${this.sessionId}.`);
    
    // Safely tear down the broken SignalR engine if it exists
    if (this.signalRClient) {
      try { this.signalRClient.stop(); } catch {}
      this.signalRClient = null;
    }

    // Switch tracks instantly to the REST Polling engine
    this.client.startPolling();
  }

  stop(): void {
    if (this.isUsingFallback) {
      this.client.stopPolling();
    } else if (this.signalRClient) {
      this.signalRClient.stop();
    }
    this.started = false;
    this.isUsingFallback = false;
    console.log(`[Live Runtime] Tearing down session runtime: ${this.sessionId}`);
  }
}

class ReplaySessionRuntime extends BaseRuntime {
  private events: ReplayEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private currentIndex = 0;
  private complete = false;
  private isPaused = false;
  private pauseTimer: NodeJS.Timeout | null = null;

  constructor(session: OpenF1Session, callbacks: RuntimeCallbacks) {
    super(session, 'replay', REPLAY_SPEED, callbacks);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.events = [];
    this.currentIndex = 0;
    this.complete = false;
    this.isPaused = false;
    this.client.setSession(this.session.session_key);
    await this.snapshotStore.initialize(this.session.session_key, {
      sessionMode: 'replay',
      replaySpeed: REPLAY_SPEED,
    });

    const laps = await this.client.fetchLaps();
    const positions = await this.client.fetchPositions();
    const intervals = await this.client.fetchIntervals();
    const pits = await this.client.fetchPits();
    const stints = await this.client.fetchStints();
    const raceControl = await this.client.fetchRaceControl();
    const totalLaps = (laps ?? []).reduce((maxLap, lap) => Math.max(maxLap, lap.lap_number), 0);

    this.snapshotStore.setTotalLaps(totalLaps > 0 ? totalLaps : null);
    this.snapshotStore.processStintUpdate(stints ?? []);

    this.events = buildReplayTimeline({
      laps: laps ?? [],
      positions: positions ?? [],
      intervals: intervals ?? [],
      pits: pits ?? [],
      raceControl: raceControl ?? [],
    });

    this.runNext();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
    this.started = false;
  }

  pause(): void {
    if (this.isPaused || !this.started) return;
    this.isPaused = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  resume(): void {
    if (!this.isPaused || !this.started) return;
    this.isPaused = false;
    this.runNext();
  }

  isPausedState(): boolean {
    return this.isPaused;
  }

  private runNext(): void {
    if (!this.started || this.isPaused) return;

    const currentEvent = this.events[this.currentIndex];
    if (!currentEvent) {
      if (!this.complete) {
        this.complete = true;
        this.snapshotStore.markReplayComplete();
        void this.callbacks.onReplayComplete(this.snapshotStore.getCurrentSnapshot(), cloneLobbyIds(this.lobbyIds));
      }
      return;
    }

    this.applyEvent(currentEvent);
    this.currentIndex += 1;

    const nextEvent = this.events[this.currentIndex];
    if (!nextEvent) {
      this.runNext();
      return;
    }

    const delayMs = Math.max(0, Math.round((nextEvent.timestamp - currentEvent.timestamp) / REPLAY_SPEED));
    this.timer = setTimeout(() => this.runNext(), delayMs);
  }

  private applyEvent(event: ReplayEvent): void {
    switch (event.type) {
      case 'race_control':
        this.snapshotStore.processRaceControlUpdate([event.data as OpenF1RaceControl]);
        break;
      case 'position':
        this.snapshotStore.processPositionUpdate([event.data as OpenF1Position]);
        break;
      case 'interval':
        this.snapshotStore.processIntervalUpdate([event.data as OpenF1Interval]);
        break;
      case 'pit':
        this.snapshotStore.processPitUpdate([event.data as OpenF1Pit]);
        break;
      case 'lap':
        this.snapshotStore.processLapCompletion(event.data as OpenF1Lap);
        break;
      default:
        break;
    }
  }
}

export class SessionRuntimeManager {
  private runtimes = new Map<string, SessionRuntime>();
  private lobbyRuntimeKeys = new Map<string, string>();
  private readonly callbacks: RuntimeCallbacks;

  constructor(callbacks: RuntimeCallbacks) {
    this.callbacks = callbacks;
  }

  getSessionMode(session: OpenF1Session): SessionMode {
    const endDate = new Date(session.date_end).getTime();
    return endDate < Date.now() ? 'replay' : 'live';
  }

  private getRuntimeKey(lobbyId: string, session: OpenF1Session): string {
    const mode = this.getSessionMode(session);
    if (mode === 'replay') {
      return `replay:${lobbyId}:${session.session_key}`;
    }

    return `live:${session.session_key}`;
  }

  async attachLobbyToSession(lobbyId: string, session: OpenF1Session): Promise<SessionRuntime> {
    const runtimeKey = this.getRuntimeKey(lobbyId, session);
    let runtime = this.runtimes.get(runtimeKey);
    if (!runtime) {
      const mode = this.getSessionMode(session);
      runtime = mode === 'replay'
        ? new ReplaySessionRuntime(session, this.callbacks)
        : new LiveSessionRuntime(session, this.callbacks);
      this.runtimes.set(runtimeKey, runtime);
    }

    runtime.addLobby(lobbyId);
    this.lobbyRuntimeKeys.set(lobbyId, runtimeKey);
    await runtime.start();
    return runtime;
  }

  detachLobbyFromSession(lobbyId: string): void {
    const runtimeKey = this.lobbyRuntimeKeys.get(lobbyId);
    if (!runtimeKey) return;

    const runtime = this.runtimes.get(runtimeKey);
    if (!runtime) return;

    runtime.removeLobby(lobbyId);
    if (runtime.getLobbyIds().size === 0) {
      this.runtimes.delete(runtimeKey);
    }
    this.lobbyRuntimeKeys.delete(lobbyId);
  }

  getRuntime(sessionId: string): SessionRuntime | null {
    return this.runtimes.get(`live:${sessionId}`) ?? null;
  }

  getRuntimeForLobby(lobbyId: string): SessionRuntime | null {
    const runtimeKey = this.lobbyRuntimeKeys.get(lobbyId);
    if (!runtimeKey) {
      return null;
    }

    return this.runtimes.get(runtimeKey) ?? null;
  }
}

export function toSessionInfo(session: OpenF1Session): OpenF1Session & { isCompleted: boolean; mode: SessionMode } {
  const isCompleted = new Date(session.date_end).getTime() < Date.now();
  return {
    ...session,
    isCompleted,
    mode: isCompleted ? 'replay' : 'live',
  };
}
