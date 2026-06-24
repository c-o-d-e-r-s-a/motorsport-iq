import type {
  RaceSnapshot,
  DriverState,
  TrackStatus,
  OpenF1Driver,
  OpenF1Lap,
  OpenF1Position,
  OpenF1Interval,
  OpenF1Pit,
  OpenF1Stint,
  OpenF1RaceControl,
  DerivedSignals,
  SessionMode,
} from '../types';
import { isOvertakeModeArmed } from '../engine/derivedSignals';
import type { OpenF1Client } from './openf1Client';
import { classifySectorFlag } from './raceStatus';
import { mergeStintRecords, resolveTyreCompound } from './tyreCompoundResolver';

interface SnapshotStoreOptions {
  onSnapshotUpdate?: (snapshot: RaceSnapshot) => void;
  onLapComplete?: (snapshot: RaceSnapshot) => void;
}

interface DriverData {
  driver: OpenF1Driver | null;
  latestPosition: OpenF1Position | null;
  latestInterval: OpenF1Interval | null;
  latestLap: OpenF1Lap | null;
  pits: OpenF1Pit[];
  stints: OpenF1Stint[];
  latestCompound: string | null;
}

const DEBUG_DRIVER_PROVENANCE = process.env.DEBUG_DRIVER_PROVENANCE === 'true';
const DEBUG_MISSING_COMPOUND = process.env.DEBUG_MISSING_COMPOUND === 'true';
const HUD_SNAPSHOT_THROTTLE_MS = 1_000;
const MAX_REASONABLE_USED_TYRE_START_AGE_AFTER_LIVE_PIT = 8;

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
  /** Sectors currently under a localized yellow — display-only, never gates gameplay. */
  private activeYellowSectors = new Set<number>();

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
    this.activeYellowSectors.clear();
    this.sessionMode = config?.sessionMode ?? 'live';
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
            latestInterval: null,
            latestLap: null,
            pits: [],
            stints: [],
            latestCompound: null,
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
    if (status === this.trackStatus) {
      return;
    }
    this.trackStatus = status;
    if (this.currentSnapshot) {
      this.buildSnapshot();
    }
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
          latestInterval: null,
          latestLap: null,
          pits: [],
          stints: [],
          latestCompound: null,
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

    this.scheduleHudSnapshotUpdate();
  }

  /** Seed compounds and emit an initial HUD snapshot after replay/sim stint preload. */
  bootstrapAfterStintPreload(): void {
    for (const data of this.drivers.values()) {
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
      latestInterval: null,
      latestLap: null,
      pits: [],
      stints: [],
      latestCompound: null,
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
    this.buildSnapshot();

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
      if (hasNewerTimestamp(pos.date, driverData.latestPosition?.date)) {
        driverData.latestPosition = pos;
      }

      if (pos.position > 0) {
        this.driverHadValidPosition.add(pos.driver_number);
      } else if (
        pos.position === 0
        && this.lapNumber > 3
        && this.driverHadValidPosition.has(pos.driver_number)
      ) {
        // Driver had a valid race position, now shows 0 — they have retired.
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
        this.refreshLatestCompound(driverData);
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

    const statusParser = (
      this.client as OpenF1Client & {
        parseRaceControlStatus?: (messages: OpenF1RaceControl[]) => TrackStatus | null;
      }
    ).parseRaceControlStatus;
    const nextTrackStatus = statusParser
      ? statusParser.call(this.client, messages)
      : this.client.parseTrackStatus(messages);

    const trackStatusChanged = Boolean(nextTrackStatus) && nextTrackStatus !== this.trackStatus;
    if (trackStatusChanged) {
      this.trackStatus = nextTrackStatus as TrackStatus;
    }

    if ((trackStatusChanged || sectorFlagsChanged) && this.currentSnapshot) {
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

  private buildSnapshot(): void {
    if (!this.sessionId) return;

    this.previousSnapshot = this.currentSnapshot;
    const driverStates: DriverState[] = [];

    for (const [driverNumber, data] of this.drivers) {
      if (!data.driver) continue;

      const tyreAge = this.calculateTyreAge(data);
      const activeStint = this.getActiveStintForCurrentLap(data);
      const stintNumber = activeStint?.stint_number ?? data.pits.length + 1;
      const tyreCompound = resolveTyreCompound(data, activeStint);
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
        tyreAge: this.calculateCurrentTyreAge(activeStint, tyreAge),
        stintNumber,
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

    const normalizedPosition = (value: number): number => (value > 0 ? value : Number.MAX_SAFE_INTEGER);

    driverStates.sort((a, b) => normalizedPosition(a.position) - normalizedPosition(b.position));
    const previousLeaderDriverNumber = this.previousSnapshot?.drivers.find((driver) => driver.position > 0)?.driverNumber;
    const leader = driverStates.find((driver) => driver.position > 0)
      ?? (previousLeaderDriverNumber
        ? driverStates.find((driver) => driver.driverNumber === previousLeaderDriverNumber)
        : null)
      ?? driverStates[0];
    const leaderLapStartTime = leader
      ? this.drivers.get(leader.driverNumber)?.latestLap?.date_start ?? null
      : null;
    const orderedDrivers = leader
      ? [leader, ...driverStates.filter((driver) => driver.driverNumber !== leader.driverNumber)]
      : driverStates;

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
      if (existing.lap_start === null || existing.lap_start > nextLapStart || existing.lap_start <= pit.lap_number - 1) {
        existing.lap_start = nextLapStart;
      }
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
      return;
    }

    data.stints.push({
      date: pit.date,
      session_key: pit.session_key,
      meeting_key: pit.meeting_key,
      driver_number: pit.driver_number,
      stint_number: nextStintNumber,
      lap_start: nextLapStart,
      lap_end: null,
      compound: data.latestCompound,
      tyre_age_at_start: 0,
    });
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

  private getActiveStintForCurrentLap(data: DriverData): OpenF1Stint | null {
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
