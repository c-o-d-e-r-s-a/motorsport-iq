import { OpenF1Client } from '../data/openf1Client';
import { getScheduledLaps } from '../data/f1Calendar';
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
  private raceFinished = false;

  constructor(session: OpenF1Session, callbacks: RuntimeCallbacks) {
    super(session, 'live', null, callbacks);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.raceFinished = false;

    // We intentionally do NOT call client.setSession or any OpenF1 data
    // endpoint here. While a live session is in progress OpenF1 returns
    // 401 "Live F1 session in progress" on every data route, so the
    // entire live pipeline is fed by the F1 SignalR feed.
    await this.snapshotStore.initialize(this.session.session_key, {
      sessionMode: 'live',
      replaySpeed: null,
      skipDriverPreload: true,
    });

    const scheduledLaps = getScheduledLaps(this.session);
    if (scheduledLaps) {
      this.snapshotStore.setTotalLaps(scheduledLaps);
    }

    console.log(`[Live Runtime] Booting SignalR streaming pipeline for session: ${this.sessionId}`);

    this.signalRClient = new F1SignalRClient({
      onPositionUpdate: (positions) => this.snapshotStore.processPositionUpdate(positions),
      onIntervalUpdate: (intervals) => this.snapshotStore.processIntervalUpdate(intervals),
      onLapCompletion: (lap) => this.snapshotStore.processLapCompletion(lap),
      onTimingProgress: (maxLap) => this.snapshotStore.syncLapNumber(maxLap),
      onTrackStatusChange: (status) => {
        this.snapshotStore.setTrackStatus(status);
        
        // Auto-finish live sessions when chequered flag appears. This handles
        // the edge case where SignalR keeps streaming cooldown lap data after
        // the race ends but before the calendar's scheduled date_end. Without
        // this, users joining a "live" session 5-10 minutes after the flag
        // would see telemetry updates but zero questions (all blocked by
        // CHEQUERED guard in the question engine).
        if (status === 'CHEQUERED' && !this.raceFinished) {
          this.raceFinished = true;
          console.log(`[Live Runtime] Chequered flag detected for session ${this.sessionId}. Marking all attached lobbies as finished.`);
          
          // Reuse the replay completion flow — marks lobbies finished, clears
          // timers, broadcasts final state, and stops accepting new questions.
          void this.callbacks.onReplayComplete(
            this.snapshotStore.getCurrentSnapshot(),
            cloneLobbyIds(this.lobbyIds)
          );
        }
      },
      onTotalLaps: (totalLaps) => this.snapshotStore.setTotalLaps(totalLaps),
      onDriverList: (drivers) => this.snapshotStore.processDriverListUpdate(drivers),
      onStintUpdate: (stints) => this.snapshotStore.processStintUpdate(stints),
      onCompoundUpdate: (driverNumber, compound) => {
        this.snapshotStore.processCompoundUpdate(driverNumber, compound);
      },
      onPitUpdate: (pits) => this.snapshotStore.processPitUpdate(pits),
      onConnectionLoss: () => {
        console.warn(`[Live Runtime] SignalR connection unstable for session ${this.sessionId}. Monitoring...`);
        this.snapshotStore.handleFeedStall(true);
      },
      onConnectionRestored: () => {
        console.log(`[Live Runtime] SignalR connection restored for session ${this.sessionId}.`);
        this.snapshotStore.handleFeedStall(false);
      },
      onConnectionClosedPermanently: () => {
        // OpenF1 is unusable while the live session is in progress, so we
        // surface a feed-stall instead of attempting a REST fallback that
        // would 401. Operators will see the stall banner on the client.
        console.error(`[Live Runtime] SignalR closed permanently for session ${this.sessionId}. Feed marked stalled (no REST fallback during live window).`);
        this.snapshotStore.handleFeedStall(true);
        this.callbacks.onFeedStall(true, cloneLobbyIds(this.lobbyIds));
      },
    });

    try {
      await this.signalRClient.start();
      console.log('[Live Runtime] SignalR connection established.');
    } catch (error: any) {
      console.error(`[Live Runtime] SignalR handshake failed:`, error?.message ?? error);
      this.snapshotStore.handleFeedStall(true);
      this.callbacks.onFeedStall(true, cloneLobbyIds(this.lobbyIds));
    }
  }

  stop(): void {
    if (this.signalRClient) {
      this.signalRClient.stop();
      this.signalRClient = null;
    }
    this.started = false;
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

export function toSessionInfo(session: OpenF1Session): OpenF1Session & { isCompleted: boolean; isLive: boolean; mode: SessionMode } {
  const now = Date.now();
  const start = new Date(session.date_start).getTime();
  const end = new Date(session.date_end).getTime();
  const isCompleted = end < now;
  const isLive = start <= now && now < end;
  return {
    ...session,
    isCompleted,
    isLive,
    mode: isLive ? 'live' : 'replay',
  };
}
