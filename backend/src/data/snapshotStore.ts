import type {
  RaceSnapshot,
  DriverState,
  TrackStatus,
  OpenF1Driver,
  OpenF1Lap,
  OpenF1Position,
  PositionSource,
  OpenF1Interval,
  OpenF1Pit,
  OpenF1Stint,
  OpenF1RaceControl,
  DerivedSignals,
  SessionMode,
} from '../types';
import { isOvertakeModeArmed } from '../engine/derivedSignals';
import type { OpenF1Client } from './openf1Client';
import { classifySectorFlag, parseLatestRaceControlStatusWithTime, parseRaceControlMessageStatus } from './raceStatus';
import { ReplayTrackStatusController } from './replayTrackStatus';
import { mergeStintRecords, resolveTyreCompound } from './tyreCompoundResolver';

interface SnapshotStoreOptions {
  onSnapshotUpdate?: (snapshot: RaceSnapshot) => void;
  onLapComplete?: (snapshot: RaceSnapshot) => void;
}

/** Tyre display locked from pit exit until the next stop — live feed often reverts after lap 0→1. */
interface ActiveStintLock {
  /** Session-relative stint (always pits.length + 1 at time of lock). */
  sessionStintNumber: number;
  compound: string;
  tyreAgeAtStart: number;
  lapStart: number;
}

interface DriverData {
  driver: OpenF1Driver | null;
  latestPosition: OpenF1Position | null;
  positionSource: PositionSource | null;
  latestInterval: OpenF1Interval | null;
  latestLap: OpenF1Lap | null;
  pits: OpenF1Pit[];
  stints: OpenF1Stint[];
  latestCompound: string | null;
  activeStintLock: ActiveStintLock | null;
}

const DEBUG_DRIVER_PROVENANCE = process.env.DEBUG_DRIVER_PROVENANCE === 'true';
const DEBUG_MISSING_COMPOUND = process.env.DEBUG_MISSING_COMPOUND === 'true';
const HUD_SNAPSHOT_THROTTLE_MS = 1_000;
const MAX_REASONABLE_USED_TYRE_START_AGE_AFTER_LIVE_PIT = 8;
/**
 * A car that has stopped completing laps while the race keeps advancing has
 * retired/crashed. OpenF1 replay never emits a clean "position → 0" retirement
 * signal, so we detect it from lap-progress staleness: if this many race laps
 * pass without the driver completing a new lap, treat them as out. A backmarker
 * being lapped still completes a lap every ~1 race lap, so this threshold never
 * flags merely-lapped cars; only genuinely stopped cars exceed it.
 */
const STALE_RACE_LAPS_FOR_RETIREMENT = 3;

const POSITION_SOURCE_PRIORITY: Record<PositionSource, number> = {
  position_z: 3,
  top_three: 2,
  timing_data: 1,
};

function positionSourcePriority(source: PositionSource | null | undefined): number {
  return source ? POSITION_SOURCE_PRIORITY[source] : 0;
}

function shouldAcceptPositionUpdate(
  incoming: OpenF1Position,
  existing: OpenF1Position | null,
  existingSource: PositionSource | null
): boolean {
  const incomingPriority = positionSourcePriority(incoming.source ?? 'timing_data');
  const existingPriority = positionSourcePriority(existingSource);

  if (incomingPriority > existingPriority) {
    return true;
  }
  if (incomingPriority < existingPriority) {
    return false;
  }
  return hasNewerTimestamp(incoming.date, existing?.date);
}

function toTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasNewerTimestamp(
  incoming: string | null | undefined,
  existing: string | null | undefined
): boolean {
  return toTimestamp(incoming) >= toTimestamp(existing);
}

function cloneRaceSnapshot(snapshot: RaceSnapshot): RaceSnapshot {
  return {
    ...snapshot,
    timestamp: new Date(snapshot.timestamp.getTime()),
    drivers: snapshot.drivers.map((driver) => ({ ...driver })),
  };
}

export class SnapshotStore {
  private sessionId: string | null = null;
  private currentSnapshot: RaceSnapshot | null = null;
  private previousSnapshot: RaceSnapshot | null = null;
  /** Last snapshot before the displayed lap counter advanced — used for question triggers. */
  private previousLapSnapshot: RaceSnapshot | null = null;
  private drivers: Map<number, DriverData> = new Map();
  private lapNumber = 0;
  private trackStatus: TrackStatus = 'GREEN';
  private totalLaps: number | null = null;
  private options: SnapshotStoreOptions;
  private previousGaps: Map<number, number> = new Map();
  private sessionMode: SessionMode = 'live';
  /** Live mode + OpenF1 replay feed: lap_number is current lap, not SignalR completed-lap. */
  private openF1LapNumbering = false;
  private replaySpeed: number | null = null;
  private isReplayComplete = false;
  private client: OpenF1Client;
  private hudSnapshotTimer: NodeJS.Timeout | null = null;
  private lastHudSnapshotAt = 0;
  /** Drivers confirmed as retired (position went to 0 after being in the race). */
  private retiredDrivers = new Set<number>();
  /** Drivers that have had at least one valid position (> 0) reported during this session. */
  private driverHadValidPosition = new Set<number>();
  /**
   * Per-driver lap-progress tracking for retirement detection: the highest lap
   * number each driver has actually completed.
   */
  private driverLapProgress = new Map<number, number>();
  /** Sectors currently under a localized yellow — display-only, never gates gameplay. */
  private activeYellowSectors = new Set<number>();
  /** Track-wide yellow caution — display-only, never gates gameplay. */
  private globalYellowActive = false;
  /** Full race-control history for cumulative status parsing in replay. */
  private raceControlHistory: OpenF1RaceControl[] = [];
  /** Timestamp of the last applied global race-control status (stale guard). */
  private lastRaceControlStatusTime = 0;
  /** Replay-only SC/VSC state machine + telemetry corroboration. */
  private replayTrackStatus: ReplayTrackStatusController | null = null;
  /** Live-only: last valid P2 gap-to-leader so HUD does not flicker to "—" between timing updates. */
  private lastValidP2Gap: number | null = null;
  /** Live-only: throttle leader-change diagnostics. */
  private lastLoggedLeaderNumber: number | null = null;

  constructor(client: OpenF1Client, options: SnapshotStoreOptions = {}) {
    this.client = client;
    this.options = options;
  }

  async initialize(
    sessionId: number,
    config?: {
      sessionMode?: SessionMode;
      replaySpeed?: number | null;
      skipDriverPreload?: boolean;
      openF1LapNumbering?: boolean;
    }
  ): Promise<void> {
    this.sessionId = String(sessionId);
    this.drivers.clear();
    this.lapNumber = 0;
    this.currentSnapshot = null;
    this.previousSnapshot = null;
    this.previousLapSnapshot = null;
    this.previousGaps.clear();
    this.trackStatus = 'GREEN';
    this.isReplayComplete = false;
    this.retiredDrivers.clear();
    this.driverHadValidPosition.clear();
    this.driverLapProgress.clear();
    this.activeYellowSectors.clear();
    this.globalYellowActive = false;
    this.raceControlHistory = [];
    this.lastRaceControlStatusTime = 0;
    this.lastValidP2Gap = null;
    this.lastLoggedLeaderNumber = null;
    this.sessionMode = config?.sessionMode ?? 'live';
    this.replayTrackStatus = this.sessionMode === 'replay' ? new ReplayTrackStatusController() : null;
    this.openF1LapNumbering = config?.openF1LapNumbering ?? false;
    this.replaySpeed = config?.replaySpeed ?? null;
    this.lastHudSnapshotAt = 0;
    if (this.hudSnapshotTimer) {
      clearTimeout(this.hudSnapshotTimer);
      this.hudSnapshotTimer = null;
    }

    if (config?.skipDriverPreload) {
      console.log('[SnapshotStore] Live session — skipping OpenF1 driver pre-load. Drivers will be populated from SignalR DriverList topic.');
      return;
    }

    try {
      const driverData = await this.client.getDrivers();
      if (driverData) {
        for (const driver of driverData) {
          this.drivers.set(driver.driver_number, {
            driver,
            latestPosition: null,
            positionSource: null,
            latestInterval: null,
            latestLap: null,
            pits: [],
            stints: [],
            latestCompound: null,
            activeStintLock: null,
          });
        }
        console.log(`[SnapshotStore] Pre-loaded ${driverData.length} drivers from OpenF1 API`);
      }
    } catch (error) {
      // OpenF1 data endpoints are auth-gated during live sessions. The
      // SignalR DriverList topic will populate driver metadata instead.
      console.warn('[SnapshotStore] Could not pre-load drivers from OpenF1 API. Falling back to live-stream driver list.');
    }
  }

  setTotalLaps(totalLaps: number | null): void {
    this.totalLaps = totalLaps && totalLaps > 0 ? totalLaps : null;

    if (this.currentSnapshot) {
      this.currentSnapshot.totalLaps = this.totalLaps;
      this.options.onSnapshotUpdate?.(this.currentSnapshot);
    }
  }

  setTrackStatus(status: TrackStatus): void {
    const changed = this.applyParsedTrackStatus(status);
    if (changed && this.currentSnapshot) {
      this.buildSnapshot();
    }
  }

  private setGlobalYellowActive(active: boolean): boolean {
    if (this.globalYellowActive === active) {
      return false;
    }
    this.globalYellowActive = active;
    return true;
  }

  /** Apply a parsed race-control status. Yellow is display-only and never stored in trackStatus. */
  private applyParsedTrackStatus(status: TrackStatus): boolean {
    if (status === 'YELLOW') {
      return this.setGlobalYellowActive(true);
    }

    const hadYellow = this.globalYellowActive;
    this.globalYellowActive = false;

    if (status === this.trackStatus && !hadYellow) {
      return false;
    }
    this.trackStatus = status;
    return true;
  }

  processDriverListUpdate(drivers: OpenF1Driver[]): void {
    for (const driver of drivers) {
      const existing = this.drivers.get(driver.driver_number);
      if (existing) {
        const hasRealName = !/^Driver \d+$/.test(driver.full_name);
        const existingIsPlaceholder = !existing.driver
          || /^Driver \d+$/.test(existing.driver.full_name);
        existing.driver = (hasRealName || existingIsPlaceholder) ? driver : existing.driver;
      } else {
        this.drivers.set(driver.driver_number, {
          driver,
          latestPosition: null,
          positionSource: null,
          latestInterval: null,
          latestLap: null,
          pits: [],
          stints: [],
          latestCompound: null,
          activeStintLock: null,
        });
      }
    }
    this.scheduleHudSnapshotUpdate();
  }

  processCompoundUpdate(driverNumber: number, compound: string): void {
    const normalizedCompound = compound.trim();
    if (!normalizedCompound) {
      return;
    }

    const driverData = this.ensureDriverEntry(driverNumber);
    driverData.latestCompound = normalizedCompound;

    const activeStint = this.getActiveStintForCurrentLap(driverData);
    if (activeStint) {
      activeStint.compound = normalizedCompound;
    } else {
      driverData.stints.push({
        date: new Date().toISOString(),
        session_key: 0,
        meeting_key: 0,
        driver_number: driverNumber,
        stint_number: driverData.pits.length + 1,
        lap_start: this.lapNumber > 0 ? this.lapNumber : 1,
        lap_end: null,
        compound: normalizedCompound,
        tyre_age_at_start: 0,
      });
    }

    this.refreshActiveStintLock(driverData, normalizedCompound);
    this.scheduleHudSnapshotUpdate();
  }

  /** Seed compounds and emit an initial HUD snapshot after replay/sim stint preload. */
  bootstrapAfterStintPreload(): void {
    for (const data of this.drivers.values()) {
      this.synthesizeMissingOpeningStints(data);
      this.refreshLatestCompound(data);
    }

    this.ensureActiveRaceLapFloor();

    if (this.sessionId) {
      this.buildSnapshot();
    }
  }

  setSessionContext(config: { sessionMode: SessionMode; replaySpeed?: number | null }): void {
    this.sessionMode = config.sessionMode;
    this.replaySpeed = config.replaySpeed ?? null;
    if (this.currentSnapshot) {
      this.currentSnapshot.sessionMode = this.sessionMode;
      this.currentSnapshot.replaySpeed = this.replaySpeed;
    }
  }

  getCurrentSnapshot(): RaceSnapshot | null {
    return this.currentSnapshot;
  }

  getPreviousSnapshot(): RaceSnapshot | null {
    return this.previousSnapshot;
  }

  getPreviousLapSnapshot(): RaceSnapshot | null {
    return this.previousLapSnapshot;
  }

  private ensureDriverEntry(driverNumber: number, sessionKey = 0, meetingKey = 0): DriverData {
    let driverData = this.drivers.get(driverNumber);
    if (driverData) return driverData;
    driverData = {
      driver: {
        driver_number: driverNumber,
        broadcast_name: `Driver ${driverNumber}`,
        full_name: `Driver ${driverNumber}`,
        name_acronym: `D${driverNumber}`,
        team_name: 'Unknown',
        team_colour: '000000',
        first_name: 'Driver',
        last_name: String(driverNumber),
        headshot_url: '',
        country_code: '',
        session_key: sessionKey,
        meeting_key: meetingKey,
      },
      latestPosition: null,
      positionSource: null,
      latestInterval: null,
      latestLap: null,
      pits: [],
      stints: [],
      latestCompound: null,
      activeStintLock: null,
    };
    this.drivers.set(driverNumber, driverData);
    console.log(`[SnapshotStore] Auto-created driver entry for #${driverNumber} from live data`);
    return driverData;
  }

  processLapCompletion(lap: OpenF1Lap): void {
    const nextLap = this.openF1LapNumbering
      ? lap.lap_number
      : lap.lap_number + 1;
    const lapAdvanced = nextLap > this.lapNumber;

    if (lapAdvanced && this.currentSnapshot) {
      this.previousLapSnapshot = cloneRaceSnapshot(this.currentSnapshot);
    }

    const driverData = this.ensureDriverEntry(lap.driver_number, lap.session_key, lap.meeting_key);
    driverData.latestLap = lap;

    if (lapAdvanced) {
      this.lapNumber = nextLap;
    }

    this.ensureActiveRaceLapFloor();

    // Track the highest lap each driver has completed, for retirement detection.
    const lastCompletedLap = this.driverLapProgress.get(lap.driver_number) ?? 0;
    if (lap.lap_number > lastCompletedLap) {
      this.driverLapProgress.set(lap.driver_number, lap.lap_number);
    }

    this.buildSnapshot();

    if (this.replayTrackStatus && lapAdvanced && this.currentSnapshot) {
      const correctedStatus = this.replayTrackStatus.onLapComplete(this.currentSnapshot);
      if (correctedStatus !== null) {
        this.applyParsedTrackStatus(correctedStatus);
        this.buildSnapshot();
      }
    }

    const shouldEmitLapComplete = this.sessionMode === 'live'
      ? Boolean(this.currentSnapshot)
      : lapAdvanced && Boolean(this.currentSnapshot);

    if (shouldEmitLapComplete) {
      this.options.onLapComplete?.(this.currentSnapshot!);
    }
  }

  syncLapNumber(lapNumber: number): void {
    if (this.sessionMode !== 'live') {
      return;
    }

    const lapAdvanced = lapNumber > this.lapNumber;
    if (!lapAdvanced) {
      return;
    }

    if (this.currentSnapshot) {
      this.previousLapSnapshot = cloneRaceSnapshot(this.currentSnapshot);
    }

    this.lapNumber = lapNumber;
    this.ensureActiveRaceLapFloor();
    this.buildSnapshot();
    if (this.currentSnapshot) {
      this.options.onLapComplete?.(this.currentSnapshot);
    }
  }

  processPositionUpdate(positions: OpenF1Position[]): void {
    for (const pos of positions) {
      const driverData = this.ensureDriverEntry(pos.driver_number, pos.session_key, pos.meeting_key);
      const incomingSource = pos.source ?? 'timing_data';

      if (shouldAcceptPositionUpdate(pos, driverData.latestPosition, driverData.positionSource)) {
        driverData.latestPosition = pos;
        driverData.positionSource = incomingSource;
      }

      if (pos.position > 0) {
        this.driverHadValidPosition.add(pos.driver_number);
        // A car can briefly report position 0 while pitting — clear a false retirement.
        if (this.sessionMode === 'live' && this.retiredDrivers.has(pos.driver_number)) {
          this.retiredDrivers.delete(pos.driver_number);
        }
      } else if (
        pos.position === 0
        && this.sessionMode !== 'live'
        && this.lapNumber > 3
        && this.driverHadValidPosition.has(pos.driver_number)
      ) {
        // Replay-only: position → 0 after being in the race means retired.
        if (!this.retiredDrivers.has(pos.driver_number)) {
          console.log(`[SnapshotStore] Driver #${pos.driver_number} marked as retired (position → 0 at lap ${this.lapNumber})`);
          this.retiredDrivers.add(pos.driver_number);
        }
      }
    }
    this.ensureActiveRaceLapFloor();
    this.scheduleHudSnapshotUpdate();
  }

  processIntervalUpdate(intervals: OpenF1Interval[]): void {
    for (const interval of intervals) {
      if (interval.gap_to_leader !== null) {
        this.previousGaps.set(interval.driver_number, interval.gap_to_leader);
      }
    }

    for (const interval of intervals) {
      const driverData = this.ensureDriverEntry(interval.driver_number, interval.session_key, interval.meeting_key);
      if (hasNewerTimestamp(interval.date, driverData.latestInterval?.date)) {
        driverData.latestInterval = interval;
      }
    }
    this.ensureActiveRaceLapFloor();
    this.scheduleHudSnapshotUpdate();
  }

  processPitUpdate(pits: OpenF1Pit[]): void {
    for (const pit of pits) {
      const driverData = this.ensureDriverEntry(pit.driver_number, pit.session_key, pit.meeting_key);
      const existingPit = driverData.pits.find((record) => record.number === pit.number);
      if (!existingPit) {
        driverData.pits.push(pit);
        this.applyPitStopToStints(driverData, pit);
        this.synthesizeMissingOpeningStints(driverData);
      }
    }
    this.scheduleHudSnapshotUpdate();
  }

  processStintUpdate(stints: OpenF1Stint[]): void {
    const touchedDrivers = new Set<number>();

    for (const stint of stints) {
      const driverData = this.ensureDriverEntry(stint.driver_number, stint.session_key, stint.meeting_key);
      touchedDrivers.add(stint.driver_number);
      const normalizedStint = this.normalizeStintAfterLivePit(driverData, stint);

      const existingIndex = driverData.stints.findIndex((entry) => entry.stint_number === normalizedStint.stint_number);
      if (existingIndex === -1) {
        driverData.stints.push(normalizedStint);
      } else {
        const existing = driverData.stints[existingIndex];
        const hasIncomingTimestamp = Boolean(normalizedStint.date);
        const hasExistingTimestamp = Boolean(existing.date);
        const shouldReplace = (
          hasIncomingTimestamp
          && hasExistingTimestamp
          && hasNewerTimestamp(normalizedStint.date, existing.date)
        )
        || (
          hasIncomingTimestamp
          && !hasExistingTimestamp
        )
        || (
          normalizedStint.stint_number === existing.stint_number
          && (normalizedStint.lap_start ?? -1) >= (existing.lap_start ?? -1)
        );

        if (shouldReplace) {
          driverData.stints[existingIndex] = mergeStintRecords(existing, normalizedStint);
        }
      }
    }

    for (const driverNumber of touchedDrivers) {
      const driverData = this.drivers.get(driverNumber);
      if (driverData) {
        this.synthesizeMissingOpeningStints(driverData);
        this.refreshLatestCompound(driverData);
        this.syncActiveStintLockFromStints(driverData);
      }
    }

    this.scheduleHudSnapshotUpdate();
  }

  processRaceControlUpdate(messages: OpenF1RaceControl[]): void {
    const sessionStarted = messages.some(
      (message) => message.category === 'SessionStatus'
        && message.message?.toUpperCase() === 'SESSION STARTED'
    );

    if (sessionStarted && this.lapNumber < 1) {
      this.lapNumber = 1;
      if (this.sessionId) {
        this.buildSnapshot();
      }
    }

    // Track localized sector yellows for display. This is intentionally
    // independent of global track status and never changes `this.trackStatus`.
    const sectorFlagsChanged = this.applySectorFlagMessages(messages);

    this.raceControlHistory.push(...messages);

    let trackStatusChanged = false;
    if (this.replayTrackStatus) {
      const nextStatus = this.replayTrackStatus.processMessages(messages);
      if (nextStatus !== null) {
        trackStatusChanged = this.applyParsedTrackStatus(nextStatus);
      }

      for (const message of messages) {
        const parsed = parseRaceControlMessageStatus(message);
        if (parsed === 'YELLOW') {
          trackStatusChanged = this.applyParsedTrackStatus('YELLOW') || trackStatusChanged;
        } else if (parsed === 'GREEN') {
          trackStatusChanged = this.applyParsedTrackStatus('GREEN') || trackStatusChanged;
        }
      }
    } else {
      const latest = parseLatestRaceControlStatusWithTime(this.raceControlHistory);

      if (latest) {
        const isStale = latest.time > 0 && latest.time < this.lastRaceControlStatusTime;
        if (!isStale) {
          if (latest.time > 0) {
            this.lastRaceControlStatusTime = Math.max(this.lastRaceControlStatusTime, latest.time);
          }
          trackStatusChanged = this.applyParsedTrackStatus(latest.status);
        }
      }
    }

    if (trackStatusChanged || sectorFlagsChanged) {
      this.buildSnapshot();
    }
  }

  /**
   * Update the displayed localized-yellow sectors from race-control messages.
   * Used by both replay (raw OpenF1 messages) and live (SignalR-shaped
   * messages forwarded by the live timing client). Returns whether the set of
   * active sectors changed. Never affects gameplay-gating track status.
   */
  processSectorFlagMessages(messages: OpenF1RaceControl[]): void {
    if (this.applySectorFlagMessages(messages) && this.currentSnapshot) {
      this.buildSnapshot();
    }
  }

  private applySectorFlagMessages(messages: OpenF1RaceControl[]): boolean {
    if (messages.length === 0) {
      return false;
    }

    const ordered = [...messages].sort(
      (a, b) => toTimestamp(a.date) - toTimestamp(b.date)
    );

    let changed = false;
    for (const message of ordered) {
      const action = classifySectorFlag(message);
      switch (action.kind) {
        case 'set':
          if (!this.activeYellowSectors.has(action.sector)) {
            this.activeYellowSectors.add(action.sector);
            changed = true;
          }
          break;
        case 'clear':
          if (this.activeYellowSectors.delete(action.sector)) {
            changed = true;
          }
          break;
        case 'clearAll':
          if (this.activeYellowSectors.size > 0) {
            this.activeYellowSectors.clear();
            changed = true;
          }
          break;
        default:
          break;
      }
    }

    return changed;
  }

  handleFeedStall(stalled: boolean): void {
    if (this.currentSnapshot) {
      this.currentSnapshot.dataFeedStalled = stalled;
      this.options.onSnapshotUpdate?.(this.currentSnapshot);
    }
  }

  markReplayComplete(): void {
    this.isReplayComplete = true;
    if (this.currentSnapshot) {
      this.currentSnapshot.isReplayComplete = true;
      this.options.onSnapshotUpdate?.(this.currentSnapshot);
    }
  }

  /**
   * Mark drivers retired when they have stopped completing laps while the rest
   * of the field keeps lapping. Works for replay (no clean retirement feed) and
   * live alike. Retirement is sticky — once out, a car stays out for the session.
   *
   * Stalls are measured against the furthest lap any car has actually COMPLETED
   * (the field's max completed lap), never against the displayed race lap. The
   * displayed lap can jump forward on its own (syncLapNumber, sparse/throttled
   * telemetry) without any new lap completions; anchoring on real completions
   * means such jumps can never falsely retire a still-running car (e.g. the
   * leader), while a car that genuinely stops still falls behind the field.
   */
  private updateRetirementStatus(): void {
    // Live classification comes from the F1 timing feed (position + gaps).
    // Lap-stall retirement falsely marks legitimately lapped cars as out.
    if (this.sessionMode === 'live') {
      return;
    }

    let fieldMaxLap = 0;
    for (const driverNumber of this.driverHadValidPosition) {
      const lap = this.driverLapProgress.get(driverNumber) ?? 0;
      if (lap > fieldMaxLap) {
        fieldMaxLap = lap;
      }
    }

    if (fieldMaxLap < 4) {
      return;
    }

    for (const driverNumber of this.driverHadValidPosition) {
      if (this.retiredDrivers.has(driverNumber)) {
        continue;
      }

      const driverLap = this.driverLapProgress.get(driverNumber) ?? 0;
      const lapsBehindField = fieldMaxLap - driverLap;
      if (lapsBehindField >= STALE_RACE_LAPS_FOR_RETIREMENT) {
        console.log(
          `[SnapshotStore] Driver #${driverNumber} marked as retired ` +
          `(${lapsBehindField} laps behind the field; last completed lap ${driverLap} vs field lap ${fieldMaxLap})`
        );
        this.retiredDrivers.add(driverNumber);
      }
    }
  }

  /**
   * When interval data says one car is on zero gap but position integers disagree,
   * trust the timing gap (authoritative during races) over stale position slots.
   */
  private reconcileLivePositionsFromGap(driverStates: DriverState[]): void {
    const active = driverStates.filter((driver) => !driver.retired);
    const gapLeader = active.find((driver) => driver.gap === 0);
    if (!gapLeader) {
      return;
    }

    const currentLeader = active.find((driver) => driver.position === 1);
    if (currentLeader?.driverNumber === gapLeader.driverNumber) {
      return;
    }

    gapLeader.position = 1;
    const chasing = active
      .filter((driver) => driver.driverNumber !== gapLeader.driverNumber)
      .filter((driver) => driver.gap !== null && Number.isFinite(driver.gap) && driver.gap > 0)
      .sort((a, b) => (a.gap ?? Number.MAX_SAFE_INTEGER) - (b.gap ?? Number.MAX_SAFE_INTEGER));

    let nextPosition = 2;
    for (const driver of chasing) {
      driver.position = nextPosition;
      nextPosition += 1;
    }
  }

  private buildSnapshot(): void {
    if (!this.sessionId) return;

    this.updateRetirementStatus();
    this.previousSnapshot = this.currentSnapshot;
    const driverStates: DriverState[] = [];

    for (const [driverNumber, data] of this.drivers) {
      if (!data.driver) continue;

      const tyreAge = this.calculateTyreAge(data);
      const activeStint = this.getActiveStintForCurrentLap(data);
      const lockedDisplay = this.resolveLockedTyreDisplay(data, activeStint, tyreAge);
      const sessionStintNumber = this.getSessionStintNumber(data);
      const tyreCompound = lockedDisplay.tyreCompound;
      const displayTyreAge = lockedDisplay.tyreAge;
      const name = data.driver.full_name || data.driver.broadcast_name || `Driver ${driverNumber}`;
      const nameSource = data.driver.full_name
        ? 'full_name'
        : data.driver.broadcast_name
          ? 'broadcast_name'
          : 'unknown';

      driverStates.push({
        driverNumber,
        name,
        nameSource,
        lastTelemetryTimestamp: this.getDriverTelemetryTimestamp(data),
        team: data.driver.team_name,
        position: data.latestPosition?.position ?? 0,
        gap: data.latestInterval?.gap_to_leader ?? null,
        interval: data.latestInterval?.interval ?? null,
        tyreCompound,
        tyreAge: displayTyreAge,
        stintNumber: sessionStintNumber,
        overtakeModeArmed: false,
        pitCount: data.pits.length,
        lastLapTime: data.latestLap?.lap_duration ?? null,
        inPit: false,
        retired: this.retiredDrivers.has(driverNumber),
      });

      if (
        DEBUG_MISSING_COMPOUND
        && !tyreCompound
        && this.lapNumber >= 3
        && (data.latestPosition?.position ?? 0) === 1
      ) {
        console.warn(
          `[SnapshotStore] Missing compound for leader #${driverNumber} at lap ${this.lapNumber} ` +
          `(stints=${data.stints.length}, latestCompound=${data.latestCompound ?? 'null'})`
        );
      }
    }

    if (this.sessionMode === 'live') {
      this.reconcileLivePositionsFromGap(driverStates);
    }

    if (this.sessionMode === 'live') {
      const p2Driver = driverStates.find((driver) => driver.position === 2 && !driver.retired);
      if (p2Driver) {
        if (p2Driver.gap !== null && Number.isFinite(p2Driver.gap)) {
          this.lastValidP2Gap = p2Driver.gap;
        } else if (this.lastValidP2Gap !== null) {
          p2Driver.gap = this.lastValidP2Gap;
        }
      }
    }

    const normalizedPosition = (value: number): number => (value > 0 ? value : Number.MAX_SAFE_INTEGER);

    const activeByPosition = driverStates
      .filter((driver) => driver.position > 0 && !driver.retired)
      .sort((a, b) => normalizedPosition(a.position) - normalizedPosition(b.position));
    const retiredByPosition = driverStates
      .filter((driver) => driver.retired && driver.position > 0)
      .sort((a, b) => normalizedPosition(a.position) - normalizedPosition(b.position));
    const inactiveDrivers = driverStates.filter(
      (driver) => driver.position <= 0 && !driver.retired
    );

    const previousLeaderDriverNumber = this.previousSnapshot?.drivers.find(
      (driver) => driver.position > 0 && !driver.retired
    )?.driverNumber;
    // A retired car keeps its last (frozen) position, so it must never be picked
    // as the leader — otherwise a retired race leader would stay on the leader card.
    const previousLeader = previousLeaderDriverNumber != null
      ? driverStates.find((driver) => driver.driverNumber === previousLeaderDriverNumber)
      : null;
    const classifiedLeader = activeByPosition[0] ?? null;

    // During a live pit stop the race leader often reports position 0 briefly.
    // Keep them on the leader card until a fresh classified P1 arrives.
    const leader = (
      this.sessionMode === 'live'
      && previousLeader
      && !previousLeader.retired
      && previousLeader.position === 0
      && classifiedLeader
    )
      ? previousLeader
      : classifiedLeader
      ?? previousLeader
      ?? driverStates.find((driver) => driver.position > 0)
      ?? driverStates[0];
    const leaderLapStartTime = leader
      ? this.drivers.get(leader.driverNumber)?.latestLap?.date_start ?? null
      : null;
    let orderedDrivers = [...activeByPosition, ...retiredByPosition, ...inactiveDrivers];
    if (
      leader
      && !activeByPosition.some((driver) => driver.driverNumber === leader.driverNumber)
    ) {
      orderedDrivers = [
        leader,
        ...orderedDrivers.filter((driver) => driver.driverNumber !== leader.driverNumber),
      ];
    }

    const draftSnapshot: RaceSnapshot = {
      sessionId: this.sessionId,
      lapNumber: this.lapNumber,
      totalLaps: this.totalLaps,
      trackStatus: this.trackStatus,
      sessionMode: this.sessionMode,
      replaySpeed: this.replaySpeed,
      isReplayComplete: this.isReplayComplete,
      drivers: orderedDrivers,
      timestamp: new Date(),
      dataFeedStalled: false,
      leaderLapTime: leader?.lastLapTime ?? null,
      leaderLapStartTime,
      localYellowSectors: [...this.activeYellowSectors].sort((a, b) => a - b),
      globalYellowActive: this.globalYellowActive,
    };

    if (this.previousSnapshot) {
      for (const driver of orderedDrivers) {
        driver.overtakeModeArmed = isOvertakeModeArmed(
          draftSnapshot,
          this.previousSnapshot,
          driver
        );
      }
    }

    this.currentSnapshot = draftSnapshot;

    if (DEBUG_DRIVER_PROVENANCE && leader) {
      console.debug('[snapshot-driver-provenance]', {
        leader: leader.name,
        source: leader.nameSource ?? 'unknown',
        telemetryTimestamp: leader.lastTelemetryTimestamp ?? null,
      });
    }

    if (
      this.sessionMode === 'live'
      && leader
      && leader.driverNumber !== this.lastLoggedLeaderNumber
    ) {
      this.lastLoggedLeaderNumber = leader.driverNumber;
      const positionSource = this.drivers.get(leader.driverNumber)?.positionSource ?? 'unknown';
      console.log(
        `[SnapshotStore] Live leader P${leader.position}: ` +
        `#${leader.driverNumber} ${leader.name} (posSource=${positionSource})`
      );
    }

    this.options.onSnapshotUpdate?.(this.currentSnapshot);
    this.lastHudSnapshotAt = Date.now();
  }

  private hasRaceActivity(): boolean {
    for (const data of this.drivers.values()) {
      if ((data.latestPosition?.position ?? 0) > 0) {
        return true;
      }
    }
    return false;
  }

  /** Active sessions should never display lap 0 once cars are on track. */
  private ensureActiveRaceLapFloor(): void {
    if (this.hasRaceActivity() && this.lapNumber < 1) {
      this.lapNumber = 1;
    }
  }

  private scheduleHudSnapshotUpdate(): void {
    if (!this.sessionId) {
      return;
    }

    if (!this.currentSnapshot) {
      this.buildSnapshot();
      return;
    }

    const elapsed = Date.now() - this.lastHudSnapshotAt;
    const throttleMs = this.sessionMode === 'replay' ? 0 : HUD_SNAPSHOT_THROTTLE_MS;
    if (elapsed >= throttleMs && !this.hudSnapshotTimer) {
      this.buildSnapshot();
      return;
    }

    if (this.hudSnapshotTimer) {
      return;
    }

    const waitMs = Math.max(0, throttleMs - elapsed);
    this.hudSnapshotTimer = setTimeout(() => {
      this.hudSnapshotTimer = null;
      this.buildSnapshot();
    }, waitMs);
  }

  private refreshLatestCompound(data: DriverData): void {
    const activeStint = this.getActiveStintForCurrentLap(data);
    const resolved = resolveTyreCompound(data, activeStint);
    if (resolved) {
      data.latestCompound = resolved;
    }
  }

  private calculateTyreAge(data: DriverData): number {
    const lastPitLap = data.pits.length > 0
      ? Math.max(...data.pits.map((pit) => pit.lap_number))
      : 0;

    if (this.lapNumber <= 0) {
      return 0;
    }

    if (lastPitLap <= 0) {
      return Math.max(0, this.lapNumber - 1);
    }

    return Math.max(0, this.lapNumber - lastPitLap - 1);
  }

  private calculateCurrentTyreAge(stint: OpenF1Stint | null, fallbackTyreAge: number): number {
    if (!stint) {
      return fallbackTyreAge;
    }

    const lapStart = stint.lap_start ?? null;
    const tyreAgeAtStart = stint.tyre_age_at_start ?? 0;

    if (lapStart === null) {
      return fallbackTyreAge;
    }

    return Math.max(tyreAgeAtStart, tyreAgeAtStart + Math.max(0, this.lapNumber - lapStart));
  }

  private applyPitStopToStints(data: DriverData, pit: OpenF1Pit): void {
    const nextStintNumber = pit.number + 1;
    const nextLapStart = Math.max(1, pit.lap_number);

    for (const stint of data.stints) {
      if (stint.stint_number >= nextStintNumber) {
        continue;
      }

      if (stint.lap_end === null || stint.lap_end >= nextLapStart) {
        stint.lap_end = Math.max(stint.lap_start ?? 1, nextLapStart - 1);
      }
    }

    const existing = data.stints.find((stint) => stint.stint_number === nextStintNumber);
    if (existing) {
      if (existing.lap_start === null || existing.lap_start < pit.lap_number) {
        existing.lap_start = Math.max(nextLapStart, pit.lap_number + 1);
      } else if (existing.lap_start === pit.lap_number) {
        existing.lap_start = nextLapStart;
      }
      // When OpenF1 already has lap_start > pit lap (out-lap), keep it — do not pull
      // forward to the pit lap (China 2026 sprint: pit lap 13, stint lap 14).
      existing.lap_end = null;
      if (
        this.sessionMode === 'live'
        && (
          existing.tyre_age_at_start === null
          || existing.tyre_age_at_start > MAX_REASONABLE_USED_TYRE_START_AGE_AFTER_LIVE_PIT
        )
      ) {
        existing.tyre_age_at_start = 0;
      }
      this.setActiveStintLock(data, existing, pit);
      return;
    }

    const newStint: OpenF1Stint = {
      date: pit.date,
      session_key: pit.session_key,
      meeting_key: pit.meeting_key,
      driver_number: pit.driver_number,
      stint_number: nextStintNumber,
      lap_start: nextLapStart,
      lap_end: null,
      compound: data.latestCompound,
      tyre_age_at_start: 0,
    };
    data.stints.push(newStint);
    this.setActiveStintLock(data, newStint, pit);
  }

  /**
   * OpenF1 sprint sessions often omit the pre-pit opening stint and only ship the
   * post-pit record (e.g. China 2026: Russell has SOFT from lap 14 but started on
   * MEDIUM laps 1–13). Synthesize the missing opening stint instead of shifting
   * lap windows, which wrongly treated the post-pit tyre as the race starter.
   */
  private synthesizeMissingOpeningStints(data: DriverData): void {
    if (data.stints.length === 0) {
      return;
    }

    const coversLapOne = data.stints.some((stint) => {
      const lapStart = stint.lap_start ?? Number.MAX_SAFE_INTEGER;
      const lapEnd = stint.lap_end ?? Number.MAX_SAFE_INTEGER;
      return lapStart <= 1 && lapEnd >= 1;
    });
    if (coversLapOne) {
      return;
    }

    const sorted = [...data.stints].sort((a, b) => {
      const aLapStart = a.lap_start ?? Number.MAX_SAFE_INTEGER;
      const bLapStart = b.lap_start ?? Number.MAX_SAFE_INTEGER;
      if (aLapStart !== bLapStart) {
        return aLapStart - bLapStart;
      }
      return a.stint_number - b.stint_number;
    });
    const earliest = sorted[0];
    const earliestStart = earliest.lap_start;
    if (earliestStart === null || earliestStart === undefined || earliestStart <= 1) {
      return;
    }

    const pitLaps = data.pits
      .map((pit) => pit.lap_number)
      .filter((lap) => Number.isFinite(lap) && lap > 0);
    const firstPitLap = pitLaps.length > 0 ? Math.min(...pitLaps) : null;
    const openingEnd = firstPitLap ?? (earliestStart - 1);
    if (openingEnd < 1) {
      return;
    }

    const syntheticStintNumber = Math.max(1, earliest.stint_number - 1);
    const alreadySynthetic = data.stints.some(
      (stint) => stint.lap_start === 1
        && stint.stint_number === syntheticStintNumber
        && (stint.lap_end ?? openingEnd) >= 1
    );
    if (alreadySynthetic) {
      return;
    }

    data.stints.push({
      date: earliest.date ?? null,
      session_key: earliest.session_key,
      meeting_key: earliest.meeting_key,
      driver_number: earliest.driver_number,
      stint_number: syntheticStintNumber,
      lap_start: 1,
      lap_end: openingEnd,
      compound: this.inferOpeningCompound(earliest.compound),
      tyre_age_at_start: 0,
    });
  }

  /** Infer the compound fitted before a known post-pit stint when OpenF1 omits it. */
  private inferOpeningCompound(postPitCompound: string | null | undefined): string {
    switch (postPitCompound?.trim().toUpperCase()) {
      case 'SOFT':
        return 'MEDIUM';
      case 'MEDIUM':
        return 'SOFT';
      case 'HARD':
        return 'MEDIUM';
      default:
        return 'MEDIUM';
    }
  }

  private getSessionStintNumber(data: DriverData): number {
    return data.pits.length + 1;
  }

  private setActiveStintLock(data: DriverData, stint: OpenF1Stint, pit: OpenF1Pit): void {
    const compound = stint.compound?.trim()
      || data.latestCompound?.trim()
      || resolveTyreCompound(data, stint)?.trim()
      || '';
    if (!compound) {
      return;
    }

    const lapStart = Math.max(1, stint.lap_start ?? pit.lap_number);
    const tyreAgeAtStart = stint.tyre_age_at_start ?? 0;
    data.activeStintLock = {
      sessionStintNumber: this.getSessionStintNumber(data),
      compound,
      tyreAgeAtStart,
      lapStart,
    };
  }

  private refreshActiveStintLock(data: DriverData, compound: string): void {
    const lock = data.activeStintLock;
    if (!lock) {
      return;
    }

    if (lock.sessionStintNumber !== this.getSessionStintNumber(data)) {
      return;
    }

    data.activeStintLock = { ...lock, compound };
  }

  private syncActiveStintLockFromStints(data: DriverData): void {
    const lock = data.activeStintLock;
    if (!lock) {
      return;
    }

    const activeStint = this.getActiveStintForCurrentLap(data);
    if (!activeStint) {
      return;
    }

    const compound = activeStint.compound?.trim() || lock.compound;
    const lapStart = activeStint.lap_start ?? lock.lapStart;
    const tyreAgeAtStart = activeStint.tyre_age_at_start ?? lock.tyreAgeAtStart;
    data.activeStintLock = {
      ...lock,
      compound,
      lapStart: Math.max(1, lapStart),
      tyreAgeAtStart,
    };
  }

  private resolveLockedTyreDisplay(
    data: DriverData,
    activeStint: OpenF1Stint | null,
    fallbackTyreAge: number
  ): { tyreCompound: string | null; tyreAge: number } {
    const sessionStintNumber = this.getSessionStintNumber(data);
    const lock = data.activeStintLock;

    if (lock && lock.sessionStintNumber === sessionStintNumber && lock.compound) {
      const effectiveLap = Math.max(this.lapNumber, lock.lapStart);
      const tyreAge = lock.tyreAgeAtStart + Math.max(0, effectiveLap - lock.lapStart);
      return {
        tyreCompound: lock.compound,
        tyreAge,
      };
    }

    const tyreCompound = resolveTyreCompound(data, activeStint);
    return {
      tyreCompound,
      tyreAge: this.calculateCurrentTyreAge(activeStint, fallbackTyreAge),
    };
  }

  private normalizeStintAfterLivePit(data: DriverData, stint: OpenF1Stint): OpenF1Stint {
    if (this.sessionMode !== 'live') {
      return stint;
    }

    const precedingPit = data.pits.find((pit) => pit.number + 1 === stint.stint_number);
    if (!precedingPit) {
      return stint;
    }

    const normalized = { ...stint };
    const expectedLapStart = Math.max(1, precedingPit.lap_number);
    if (normalized.lap_start === null || normalized.lap_start <= precedingPit.lap_number - 1) {
      normalized.lap_start = expectedLapStart;
    }

    if (
      normalized.tyre_age_at_start !== null
      && normalized.tyre_age_at_start > MAX_REASONABLE_USED_TYRE_START_AGE_AFTER_LIVE_PIT
    ) {
      normalized.tyre_age_at_start = 0;
    }

    return normalized;
  }

  private getDriverTelemetryTimestamp(data: DriverData): string | null {
    const activeStint = this.getActiveStintForCurrentLap(data);
    const timestamps = [
      data.latestPosition?.date ?? null,
      data.latestInterval?.date ?? null,
      data.latestLap?.date_start ?? null,
      activeStint?.date ?? null,
      data.pits.length > 0 ? data.pits[data.pits.length - 1]?.date ?? null : null,
    ];

    let latestValue: string | null = null;
    let latestTimestamp = 0;

    for (const value of timestamps) {
      const parsed = toTimestamp(value);
      if (parsed >= latestTimestamp && value) {
        latestTimestamp = parsed;
        latestValue = value;
      }
    }

    return latestValue;
  }

  /**
   * Resolve the stint the driver is on at the current lap.
   *
   * Prefer the lap window — never jump to a future stint that is preloaded for
   * later in the race. Fall back to session stint index (pit count + 1 ordered
   * by lap_start) when windows are blank (common on live feeds).
   */
  private getActiveStintForCurrentLap(data: DriverData): OpenF1Stint | null {
    if (data.stints.length === 0) {
      return null;
    }

    const byWindow = this.getStintByLapWindow(data);
    if (byWindow) {
      return byWindow;
    }

    return this.getStintBySessionIndex(data);
  }

  /**
   * Map session-relative stint (pits completed + 1) to the Nth stint ordered by
   * lap_start in this session. OpenF1 stint_number can be 2 on a sprint opener
   * when stint 1 was in qualifying — session stint 1 must still resolve correctly.
   */
  private getStintBySessionIndex(data: DriverData): OpenF1Stint | null {
    if (data.stints.length === 0) {
      return null;
    }

    const sessionStintIndex = this.getSessionStintNumber(data);
    const sorted = [...data.stints].sort((a, b) => {
      const aLapStart = a.lap_start ?? Number.MAX_SAFE_INTEGER;
      const bLapStart = b.lap_start ?? Number.MAX_SAFE_INTEGER;
      if (aLapStart !== bLapStart) {
        return aLapStart - bLapStart;
      }
      return a.stint_number - b.stint_number;
    });

    return sorted[sessionStintIndex - 1] ?? sorted[0] ?? null;
  }

  private getStintByLapWindow(data: DriverData): OpenF1Stint | null {
    if (data.stints.length === 0) {
      return null;
    }

    const sorted = [...data.stints].sort((a, b) => {
      const aLapStart = a.lap_start ?? Number.MAX_SAFE_INTEGER;
      const bLapStart = b.lap_start ?? Number.MAX_SAFE_INTEGER;
      if (aLapStart !== bLapStart) {
        return aLapStart - bLapStart;
      }
      return a.stint_number - b.stint_number;
    });

    if (this.lapNumber <= 0) {
      return sorted[0] ?? null;
    }

    const activeByWindow = sorted.filter((stint) => {
      const lapStart = stint.lap_start ?? Number.MIN_SAFE_INTEGER;
      const lapEnd = stint.lap_end ?? Number.MAX_SAFE_INTEGER;
      return lapStart <= this.lapNumber && this.lapNumber <= lapEnd;
    });

    if (activeByWindow.length > 0) {
      return activeByWindow.sort((a, b) => {
        const aLapStart = a.lap_start ?? Number.MIN_SAFE_INTEGER;
        const bLapStart = b.lap_start ?? Number.MIN_SAFE_INTEGER;
        if (aLapStart !== bLapStart) {
          return bLapStart - aLapStart;
        }
        return b.stint_number - a.stint_number;
      })[0] ?? null;
    }

    const latestKnownBeforeLap = sorted
      .filter((stint) => (stint.lap_start ?? Number.MIN_SAFE_INTEGER) <= this.lapNumber)
      .sort((a, b) => {
        const aLapStart = a.lap_start ?? Number.MIN_SAFE_INTEGER;
        const bLapStart = b.lap_start ?? Number.MIN_SAFE_INTEGER;
        if (aLapStart !== bLapStart) {
          return bLapStart - aLapStart;
        }
        return b.stint_number - a.stint_number;
      })[0];

    return latestKnownBeforeLap ?? sorted[0] ?? null;
  }

  calculateDerivedSignals(): DerivedSignals {
    const snapshot = this.currentSnapshot;
    if (!snapshot) {
      return {
        closingTrend: new Map(),
        fallingBack: new Map(),
        withinOneSecond: new Map(),
        overtakeOpportunity: new Map(),
        pitWindowOpen: new Map(),
        tyreCliffRisk: new Map(),
        lateRacePhase: false,
        podiumStabilityTrend: false,
        closeBattles: [],
        overtakeModeArmed: new Map(),
        undercutPressure: new Map(),
      };
    }

    const closingTrend = new Map<number, boolean>();
    const fallingBack = new Map<number, boolean>();
    const withinOneSecond = new Map<number, boolean>();
    const overtakeOpportunity = new Map<number, boolean>();
    const pitWindowOpen = new Map<number, boolean>();
    const tyreCliffRisk = new Map<number, boolean>();
    const overtakeModeArmed = new Map<number, boolean>();
    const undercutPressure = new Map<number, boolean>();
    const closeBattles: { attacker: number; defender: number; gap: number }[] = [];

    for (const driver of snapshot.drivers) {
      const prevGap = this.previousGaps.get(driver.driverNumber);
      const currentGap = driver.gap;
      const isClosing = prevGap !== undefined && currentGap !== null ? prevGap - currentGap > 0.1 : false;
      const isOpening = prevGap !== undefined && currentGap !== null ? currentGap - prevGap > 0.1 : false;
      const inPitWindow = driver.tyreAge >= 15 && driver.pitCount < 2;
      closingTrend.set(driver.driverNumber, isClosing);
      fallingBack.set(driver.driverNumber, isOpening);
      withinOneSecond.set(driver.driverNumber, driver.interval !== null && driver.interval <= 1.0);
      overtakeOpportunity.set(driver.driverNumber, isClosing && driver.interval !== null && driver.interval <= 1.5);

      pitWindowOpen.set(driver.driverNumber, inPitWindow);
      tyreCliffRisk.set(driver.driverNumber, driver.tyreAge >= 25);
      overtakeModeArmed.set(driver.driverNumber, driver.overtakeModeArmed);
      undercutPressure.set(
        driver.driverNumber,
        inPitWindow
          && isClosing
          && driver.position >= 3
          && driver.position <= 15
          && driver.interval !== null
          && driver.interval >= 1.5
          && driver.interval <= 4.5
      );

      if (driver.interval !== null && driver.interval < 4.0 && driver.position > 1) {
        const defender = snapshot.drivers.find((candidate) => candidate.position === driver.position - 1);
        if (defender) {
          closeBattles.push({
            attacker: driver.driverNumber,
            defender: defender.driverNumber,
            gap: driver.interval,
          });
        }
      }
    }

    return {
      closingTrend,
      fallingBack,
      withinOneSecond,
      overtakeOpportunity,
      pitWindowOpen,
      tyreCliffRisk,
      lateRacePhase: snapshot.totalLaps !== null ? snapshot.lapNumber >= Math.ceil(snapshot.totalLaps * 0.6) : false,
      podiumStabilityTrend: false,
      closeBattles,
      overtakeModeArmed,
      undercutPressure,
    };
  }
}
