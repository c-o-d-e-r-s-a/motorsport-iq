import { getScheduledLaps } from '../data/f1Calendar';
import { F1SignalRClient } from '../data/f1SignalRClient';
import type { OpenF1Session, SessionMode } from '../types';
import {
  applyReplayEvent,
  buildReplayTimeline,
  type ReplayEvent,
} from './replayTimeline';
import {
  BaseRuntime,
  cloneLobbyIds,
  computeReplayEventDelayMs,
  type RuntimeCallbacks,
  type SessionRuntime,
} from './sessionRuntimeBase';
import { SimulatedLiveSessionRuntime } from './simulatedLiveSessionRuntime';
import { toSessionInfo } from './sessionRuntimeInfo';

export const SUPPORTED_REPLAY_SPEEDS = [1, 10] as const;
export type ReplaySpeed = (typeof SUPPORTED_REPLAY_SPEEDS)[number];
export const DEFAULT_REPLAY_SPEED: ReplaySpeed = 10;

export function normalizeReplaySpeed(value: unknown): ReplaySpeed {
  if (typeof value === 'number' && (SUPPORTED_REPLAY_SPEEDS as readonly number[]).includes(value)) {
    return value as ReplaySpeed;
  }
  return DEFAULT_REPLAY_SPEED;
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

        if (status === 'CHEQUERED' && !this.raceFinished) {
          this.raceFinished = true;
          console.log(`[Live Runtime] Chequered flag detected for session ${this.sessionId}. Marking all attached lobbies as finished.`);

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
  private readonly playbackSpeed: ReplaySpeed;

  constructor(session: OpenF1Session, callbacks: RuntimeCallbacks, replaySpeed: ReplaySpeed = DEFAULT_REPLAY_SPEED) {
    super(session, 'replay', replaySpeed, callbacks);
    this.playbackSpeed = replaySpeed;
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
      replaySpeed: this.playbackSpeed,
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
    this.snapshotStore.bootstrapAfterStintPreload();

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

    applyReplayEvent(this.snapshotStore, currentEvent);
    this.currentIndex += 1;

    const nextEvent = this.events[this.currentIndex];
    if (!nextEvent) {
      this.runNext();
      return;
    }

    const delayMs = computeReplayEventDelayMs(currentEvent, nextEvent, this.playbackSpeed);
    this.timer = setTimeout(() => this.runNext(), delayMs);
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

  private getRuntimeKey(
    lobbyId: string,
    session: OpenF1Session,
    replaySpeed?: ReplaySpeed
  ): string {
    const mode = this.getSessionMode(session);
    if (mode === 'replay') {
      const speed = replaySpeed ?? DEFAULT_REPLAY_SPEED;
      return `replay:${lobbyId}:${session.session_key}:${speed}x`;
    }

    return `live:${session.session_key}`;
  }

  private getSimulationRuntimeKey(session: OpenF1Session): string {
    return `sim-live:${session.session_key}`;
  }

  async attachLobbyToSession(
    lobbyId: string,
    session: OpenF1Session,
    options?: { replaySpeed?: ReplaySpeed }
  ): Promise<SessionRuntime> {
    const mode = this.getSessionMode(session);
    const replaySpeed = mode === 'replay'
      ? normalizeReplaySpeed(options?.replaySpeed)
      : undefined;
    const runtimeKey = this.getRuntimeKey(lobbyId, session, replaySpeed);
    let runtime = this.runtimes.get(runtimeKey);
    if (!runtime) {
      runtime = mode === 'replay'
        ? new ReplaySessionRuntime(session, this.callbacks, replaySpeed)
        : new LiveSessionRuntime(session, this.callbacks);
      this.runtimes.set(runtimeKey, runtime);
    }

    runtime.addLobby(lobbyId);
    this.lobbyRuntimeKeys.set(lobbyId, runtimeKey);
    await runtime.start();
    return runtime;
  }

  async attachLobbyToSimulation(lobbyId: string, session: OpenF1Session): Promise<SessionRuntime> {
    const runtimeKey = this.getSimulationRuntimeKey(session);
    let runtime = this.runtimes.get(runtimeKey);
    if (!runtime) {
      runtime = new SimulatedLiveSessionRuntime(session, this.callbacks);
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

export type { RuntimeCallbacks, SessionRuntime };
export { toSessionInfo };
