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
import type { OpenF1Client } from './openf1Client';

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
const HUD_SNAPSHOT_THROTTLE_MS = 1_000;

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

export class SnapshotStore {
  private sessionId: string | null = null;
  private currentSnapshot: RaceSnapshot | null = null;
  private previousSnapshot: RaceSnapshot | null = null;
  private drivers: Map<number, DriverData> = new Map();
  private lapNumber = 0;
  private trackStatus: TrackStatus = 'GREEN';
  private totalLaps: number | null = null;
  private options: SnapshotStoreOptions;
  private previousGaps: Map<number, number> = new Map();
  private sessionMode: SessionMode = 'live';
  private replaySpeed: number | null = null;
  private isReplayComplete = false;
  private client: OpenF1Client;
  private hudSnapshotTimer: NodeJS.Timeout | null = null;
  private lastHudSnapshotAt = 0;

  constructor(client: OpenF1Client, options: SnapshotStoreOptions = {}) {
    this.client = client;
    this.options = options;
  }

  async initialize(
    sessionId: number,
    config?: { sessionMode?: SessionMode; replaySpeed?: number | null; skipDriverPreload?: boolean }
  ): Promise<void> {
    this.sessionId = String(sessionId);
    this.drivers.clear();
    this.lapNumber = 0;
    this.currentSnapshot = null;
    this.previousSnapshot = null;
    this.previousGaps.clear();
    this.trackStatus = 'GREEN';
    this.isReplayComplete = false;
    this.sessionMode = config?.sessionMode ?? 'live';
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
    const driverData = this.ensureDriverEntry(driverNumber);
    driverData.latestCompound = compound;

    const activeStint = this.getActiveStintForCurrentLap(driverData);
    if (activeStint) {
      activeStint.compound = compound;
    } else {
      driverData.stints.push({
        date: new Date().toISOString(),
        session_key: 0,
        meeting_key: 0,
        driver_number: driverNumber,
        stint_number: driverData.pits.length + 1,
        lap_start: this.lapNumber > 0 ? this.lapNumber : 1,
        lap_end: null,
        compound,
        tyre_age_at_start: 0,
      });
    }

    this.scheduleHudSnapshotUpdate();
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
    const driverData = this.ensureDriverEntry(lap.driver_number, lap.session_key, lap.meeting_key);
    driverData.latestLap = lap;

    // Live F1 timing reports completed laps; replays use OpenF1 lap_number as-is.
    const nextLap = this.sessionMode === 'live' ? lap.lap_number + 1 : lap.lap_number;
    if (nextLap > this.lapNumber) {
      this.lapNumber = nextLap;
    }

    this.buildSnapshot();
    if (this.currentSnapshot) {
      this.options.onLapComplete?.(this.currentSnapshot);
    }
  }

  syncLapNumber(lapNumber: number): void {
    if (this.sessionMode !== 'live') {
      return;
    }

    if (lapNumber > this.lapNumber) {
      this.lapNumber = lapNumber;
      this.scheduleHudSnapshotUpdate();
    }
  }

  processPositionUpdate(positions: OpenF1Position[]): void {
    for (const pos of positions) {
      const driverData = this.ensureDriverEntry(pos.driver_number, pos.session_key, pos.meeting_key);
      if (hasNewerTimestamp(pos.date, driverData.latestPosition?.date)) {
        driverData.latestPosition = pos;
      }
    }
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
    this.scheduleHudSnapshotUpdate();
  }

  processPitUpdate(pits: OpenF1Pit[]): void {
    for (const pit of pits) {
      const driverData = this.ensureDriverEntry(pit.driver_number, pit.session_key, pit.meeting_key);
      const existingPit = driverData.pits.find((record) => record.number === pit.number);
      if (!existingPit) {
        driverData.pits.push(pit);
      }
    }
    this.scheduleHudSnapshotUpdate();
  }

  processStintUpdate(stints: OpenF1Stint[]): void {
    for (const stint of stints) {
      const driverData = this.ensureDriverEntry(stint.driver_number, stint.session_key, stint.meeting_key);

      const existingIndex = driverData.stints.findIndex((entry) => entry.stint_number === stint.stint_number);
      if (existingIndex === -1) {
        driverData.stints.push(stint);
      } else {
        const existing = driverData.stints[existingIndex];
        const hasIncomingTimestamp = Boolean(stint.date);
        const hasExistingTimestamp = Boolean(existing.date);
        const shouldReplace = (
          hasIncomingTimestamp
          && hasExistingTimestamp
          && hasNewerTimestamp(stint.date, existing.date)
        )
        || (
          hasIncomingTimestamp
          && !hasExistingTimestamp
        )
        || (
          stint.stint_number === existing.stint_number
          && (stint.lap_start ?? -1) >= (existing.lap_start ?? -1)
        );

        if (shouldReplace) {
          driverData.stints[existingIndex] = stint;
        }
      }
    }
    this.scheduleHudSnapshotUpdate();
  }

  processRaceControlUpdate(messages: OpenF1RaceControl[]): void {
    const nextTrackStatus = this.client.parseTrackStatus(messages);

    if (nextTrackStatus === this.trackStatus) {
      return;
    }

    this.trackStatus = nextTrackStatus;

    if (this.currentSnapshot) {
      this.buildSnapshot();
    }
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
        tyreCompound: activeStint?.compound ?? data.latestCompound ?? null,
        tyreAge: this.calculateCurrentTyreAge(activeStint, tyreAge),
        stintNumber,
        drsEnabled: false,
        pitCount: data.pits.length,
        lastLapTime: data.latestLap?.lap_duration ?? null,
        inPit: false,
        retired: false,
      });
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

    this.currentSnapshot = {
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
    };

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

  private scheduleHudSnapshotUpdate(): void {
    if (!this.currentSnapshot || !this.sessionId) {
      return;
    }

    const elapsed = Date.now() - this.lastHudSnapshotAt;
    if (elapsed >= HUD_SNAPSHOT_THROTTLE_MS && !this.hudSnapshotTimer) {
      this.buildSnapshot();
      return;
    }

    if (this.hudSnapshotTimer) {
      return;
    }

    const waitMs = Math.max(0, HUD_SNAPSHOT_THROTTLE_MS - elapsed);
    this.hudSnapshotTimer = setTimeout(() => {
      this.hudSnapshotTimer = null;
      this.buildSnapshot();
    }, waitMs);
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
      };
    }

    const closingTrend = new Map<number, boolean>();
    const fallingBack = new Map<number, boolean>();
    const withinOneSecond = new Map<number, boolean>();
    const overtakeOpportunity = new Map<number, boolean>();
    const pitWindowOpen = new Map<number, boolean>();
    const tyreCliffRisk = new Map<number, boolean>();
    const closeBattles: { attacker: number; defender: number; gap: number }[] = [];

    for (const driver of snapshot.drivers) {
      const prevGap = this.previousGaps.get(driver.driverNumber);
      const currentGap = driver.gap;
      const isClosing = prevGap !== undefined && currentGap !== null ? prevGap - currentGap > 0.1 : false;
      const isOpening = prevGap !== undefined && currentGap !== null ? currentGap - prevGap > 0.1 : false;
      closingTrend.set(driver.driverNumber, isClosing);
      fallingBack.set(driver.driverNumber, isOpening);
      withinOneSecond.set(driver.driverNumber, driver.interval !== null && driver.interval <= 1.0);
      overtakeOpportunity.set(driver.driverNumber, isClosing && driver.interval !== null && driver.interval <= 1.5);

      pitWindowOpen.set(driver.driverNumber, driver.tyreAge >= 15 && driver.pitCount < 2);
      tyreCliffRisk.set(driver.driverNumber, driver.tyreAge >= 25);

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
    };
  }
}
