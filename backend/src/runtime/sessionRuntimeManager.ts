import { getScheduledLaps } from '../data/f1Calendar';
import { F1SignalRClient } from '../data/f1SignalRClient';
import { F1SignalRCoreClient } from '../data/f1SignalRCoreClient';
import { hasOpenF1ApiKey } from '../data/openf1Client';
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
import { isSessionCompleted, toSessionInfo } from './sessionRuntimeInfo';

export const SUPPORTED_REPLAY_SPEEDS = [1, 10] as const;
export type ReplaySpeed = (typeof SUPPORTED_REPLAY_SPEEDS)[number];
export const DEFAULT_REPLAY_SPEED: ReplaySpeed = 10;

export function normalizeReplaySpeed(value: unknown): ReplaySpeed {
  if (typeof value === 'number' && (SUPPORTED_REPLAY_SPEEDS as readonly number[]).includes(value)) {
    return value as ReplaySpeed;
  }
  return DEFAULT_REPLAY_SPEED;
}

type LiveTimingClient = F1SignalRClient | F1SignalRCoreClient;

class LiveSessionRuntime extends BaseRuntime {
  private liveTimingClient: LiveTimingClient | null = null;
  private usingOpenF1Fallback = false;
  private raceFinished = false;

  constructor(session: OpenF1Session, callbacks: RuntimeCallbacks) {
    super(session, 'live', null, callbacks);
  }

  private setFeedStalled(stalled: boolean): void {
    this.snapshotStore.handleFeedStall(stalled);
    this.callbacks.onFeedStall(stalled, cloneLobbyIds(this.lobbyIds));
  }

  private createLiveTimingCallbacks(): ConstructorParameters<typeof F1SignalRClient>[0] {
    return {
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
        console.warn(`[Live Runtime] Live timing connection unstable for session ${this.sessionId}. Monitoring...`);
        this.setFeedStalled(true);
      },
      onConnectionRestored: () => {
        console.log(`[Live Runtime] Live timing connection restored for session ${this.sessionId}.`);
        this.setFeedStalled(false);
      },
      onConnectionClosedPermanently: () => {
        console.error(`[Live Runtime] Live timing closed permanently for session ${this.sessionId}.`);
        void this.handleLiveTimingFailure('connection closed after reconnect attempts');
      },
    };
  }

  private async startOpenF1Fallback(reason: string): Promise<boolean> {
    if (this.usingOpenF1Fallback) {
      return true;
    }

    if (!hasOpenF1ApiKey()) {
      console.error(
        `[Live Runtime] Cannot fall back to OpenF1 (${reason}). ` +
        'Set OPENF1_API_KEY on the backend or F1_LIVE_TIMING_TOKEN for SignalR Core auth.'
      );
      this.setFeedStalled(true);
      return false;
    }

    this.usingOpenF1Fallback = true;
    console.warn(`[Live Runtime] Falling back to OpenF1 polling for session ${this.sessionId} (${reason}).`);

    if (this.liveTimingClient) {
      await this.liveTimingClient.stop();
      this.liveTimingClient = null;
    }

    await this.snapshotStore.initialize(this.session.session_key, {
      sessionMode: 'live',
      replaySpeed: null,
      skipDriverPreload: false,
    });

    const scheduledLaps = getScheduledLaps(this.session);
    if (scheduledLaps) {
      this.snapshotStore.setTotalLaps(scheduledLaps);
    }

    this.client.setSession(this.session.session_key);
    this.client.startPolling();
    this.setFeedStalled(false);
    return true;
  }

  private async handleLiveTimingFailure(reason: string): Promise<void> {
    const recovered = await this.startOpenF1Fallback(reason);
    if (!recovered) {
      this.setFeedStalled(true);
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.raceFinished = false;
    this.usingOpenF1Fallback = false;

    await this.snapshotStore.initialize(this.session.session_key, {
      sessionMode: 'live',
      replaySpeed: null,
      skipDriverPreload: true,
    });

    const scheduledLaps = getScheduledLaps(this.session);
    if (scheduledLaps) {
      this.snapshotStore.setTotalLaps(scheduledLaps);
    }

    const callbacks = this.createLiveTimingCallbacks();

    // F1 migrated live timing from legacy /signalr (401 during races) to /signalrcore.
    // The Core hub still streams over WebSocket and works without auth for race sessions.
    console.log(`[Live Runtime] Booting SignalR Core WebSocket pipeline for session: ${this.sessionId}`);
    this.liveTimingClient = new F1SignalRCoreClient(callbacks);

    try {
      await this.liveTimingClient.start();
      console.log('[Live Runtime] SignalR Core connection established.');
      this.setFeedStalled(false);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Live Runtime] SignalR Core handshake failed:', message);

      console.warn('[Live Runtime] Retrying with legacy /signalr WebSocket client...');
      this.liveTimingClient = new F1SignalRClient(callbacks);
      try {
        await this.liveTimingClient.start();
        console.log('[Live Runtime] Legacy SignalR connection established.');
        this.setFeedStalled(false);
      } catch (legacyError: unknown) {
        const legacyMessage = legacyError instanceof Error ? legacyError.message : String(legacyError);
        console.error('[Live Runtime] Legacy SignalR handshake failed:', legacyMessage);
        await this.handleLiveTimingFailure(legacyMessage);
      }
    }
  }

  stop(): void {
    if (this.liveTimingClient) {
      void this.liveTimingClient.stop();
      this.liveTimingClient = null;
    }
    if (this.usingOpenF1Fallback) {
      this.client.stopPolling();
      this.usingOpenF1Fallback = false;
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
    return isSessionCompleted(session) ? 'replay' : 'live';
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
