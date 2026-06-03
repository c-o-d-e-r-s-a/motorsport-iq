import { OpenF1Client } from '../data/openf1Client';
import { getScheduledLaps } from '../data/f1Calendar';
import type { OpenF1Session } from '../types';
import { SIMULATION_SPEED } from './featureFlags';
import {
  applyReplayEvent,
  buildReplayTimeline,
  normalizeTimelineToZero,
  type ReplayEvent,
} from './replayTimeline';
import {
  BaseRuntime,
  cloneLobbyIds,
  computeReplayEventDelayMs,
  type RuntimeCallbacks,
} from './sessionRuntimeBase';

export class SimulatedLiveSessionRuntime extends BaseRuntime {
  private events: ReplayEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private currentIndex = 0;
  private complete = false;
  readonly playbackSpeed: number;

  constructor(
    session: OpenF1Session,
    callbacks: RuntimeCallbacks,
    playbackSpeed: number = SIMULATION_SPEED
  ) {
    super(session, 'live', null, callbacks);
    this.playbackSpeed = playbackSpeed;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.events = [];
    this.currentIndex = 0;
    this.complete = false;

    this.client.setSession(this.session.session_key);
    await this.snapshotStore.initialize(this.session.session_key, {
      sessionMode: 'live',
      replaySpeed: null,
      skipDriverPreload: false,
      openF1LapNumbering: true,
    });

    const scheduledLaps = getScheduledLaps(this.session);
    if (scheduledLaps) {
      this.snapshotStore.setTotalLaps(scheduledLaps);
    }

    console.log(
      `[Simulated Live Runtime] Fetching OpenF1 telemetry for session ${this.sessionId} (1× playback)`
    );

    const laps = await this.client.fetchLaps();
    const positions = await this.client.fetchPositions();
    const intervals = await this.client.fetchIntervals();
    const pits = await this.client.fetchPits();
    const stints = await this.client.fetchStints();
    const raceControl = await this.client.fetchRaceControl();

    if (!scheduledLaps) {
      const totalLaps = (laps ?? []).reduce((maxLap, lap) => Math.max(maxLap, lap.lap_number), 0);
      this.snapshotStore.setTotalLaps(totalLaps > 0 ? totalLaps : null);
    }

    this.snapshotStore.processStintUpdate(stints ?? []);
    this.snapshotStore.bootstrapAfterStintPreload();

    this.events = normalizeTimelineToZero(
      buildReplayTimeline({
        laps: laps ?? [],
        positions: positions ?? [],
        intervals: intervals ?? [],
        pits: pits ?? [],
        raceControl: raceControl ?? [],
      })
    );

    console.log(
      `[Simulated Live Runtime] Timeline ready: ${this.events.length} events at ${this.playbackSpeed}× speed`
    );

    this.runNext();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.started = false;
    console.log(`[Simulated Live Runtime] Tearing down session runtime: ${this.sessionId}`);
  }

  private runNext(): void {
    if (!this.started) return;

    const currentEvent = this.events[this.currentIndex];
    if (!currentEvent) {
      if (!this.complete) {
        this.complete = true;
        this.snapshotStore.markReplayComplete();
        void this.callbacks.onReplayComplete(
          this.snapshotStore.getCurrentSnapshot(),
          cloneLobbyIds(this.lobbyIds)
        );
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
