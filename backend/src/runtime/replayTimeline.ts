import type { SnapshotStore } from '../data/snapshotStore';
import type {
  OpenF1Interval,
  OpenF1Lap,
  OpenF1Pit,
  OpenF1Position,
  OpenF1RaceControl,
} from '../types';

export type ReplayEventType = 'race_control' | 'position' | 'interval' | 'pit' | 'lap';

export interface ReplayEvent {
  type: ReplayEventType;
  timestamp: number;
  sequence: number;
  data: OpenF1RaceControl | OpenF1Position | OpenF1Interval | OpenF1Pit | OpenF1Lap;
}

interface ReplayTimelineInput {
  laps: OpenF1Lap[];
  positions: OpenF1Position[];
  intervals: OpenF1Interval[];
  pits: OpenF1Pit[];
  raceControl: OpenF1RaceControl[];
}

const typeOrder: Record<ReplayEventType, number> = {
  race_control: 0,
  position: 1,
  interval: 2,
  pit: 3,
  lap: 4,
};

/** Lap replay events fire at lap completion (start + duration), not lap start. */
function getLapCompletionTimestamp(lap: OpenF1Lap): number {
  if (!lap.date_start) {
    return Number.NaN;
  }

  const startMs = new Date(lap.date_start).getTime();
  if (!Number.isFinite(startMs)) {
    return Number.NaN;
  }

  if (lap.lap_duration != null && Number.isFinite(lap.lap_duration)) {
    return startMs + lap.lap_duration * 1000;
  }

  return startMs;
}

/**
 * Compute the true completion timestamp for every lap row.
 *
 * A lap completes the instant the NEXT lap for the same driver starts
 * (`date_start`). This is far more robust than `date_start + lap_duration`:
 *   - Lap 1 has no `lap_duration` in OpenF1 (standing start) and its
 *     `date_start` equals the race-start instant. Using the fallback collapsed
 *     lap 1's "completion" to t=0, which advanced the displayed lap to 2 before
 *     the race had visibly begun (the "starts at lap 2" bug).
 *   - In/out laps and any row with a missing duration are handled correctly.
 * The final lap (no successor) falls back to `date_start + lap_duration`.
 */
function buildLapCompletionTimestamps(laps: OpenF1Lap[]): Map<OpenF1Lap, number> {
  const lapsByDriver = new Map<number, OpenF1Lap[]>();
  for (const lap of laps) {
    const list = lapsByDriver.get(lap.driver_number);
    if (list) {
      list.push(lap);
    } else {
      lapsByDriver.set(lap.driver_number, [lap]);
    }
  }

  const completionByLap = new Map<OpenF1Lap, number>();
  for (const driverLaps of lapsByDriver.values()) {
    driverLaps.sort((a, b) => a.lap_number - b.lap_number);
    for (let i = 0; i < driverLaps.length; i += 1) {
      const lap = driverLaps[i];
      const nextLap = driverLaps[i + 1];
      const nextStartMs = nextLap?.date_start ? new Date(nextLap.date_start).getTime() : Number.NaN;
      const completion = Number.isFinite(nextStartMs)
        ? nextStartMs
        : getLapCompletionTimestamp(lap);
      completionByLap.set(lap, completion);
    }
  }

  return completionByLap;
}

/**
 * Collapse the starting grid into seed position events stamped at the race
 * start.
 *
 * OpenF1's `/position` endpoint only emits a record when a driver's position
 * CHANGES. The starting grid is therefore stamped well before lights-out (e.g.
 * during the formation lap) and gets discarded by the `>= startTime` filter. A
 * driver who runs wire-to-wire (or simply holds station early) then has no
 * position record at all, so the snapshot store cannot identify the leader and
 * defaults to an arbitrary driver. Re-stamping each driver's latest pre-start
 * position to the race-start instant seeds the correct grid order; genuine
 * post-start changes override it as they arrive.
 */
function buildGridSeedPositions(positions: OpenF1Position[], startTime: number): OpenF1Position[] {
  if (!Number.isFinite(startTime) || startTime <= 0) {
    return [];
  }

  const latestByDriver = new Map<number, OpenF1Position>();
  for (const pos of positions) {
    const ts = new Date(pos.date).getTime();
    if (!Number.isFinite(ts) || ts > startTime) {
      continue;
    }
    const existing = latestByDriver.get(pos.driver_number);
    if (!existing || ts >= new Date(existing.date).getTime()) {
      latestByDriver.set(pos.driver_number, pos);
    }
  }

  const startIso = new Date(startTime).toISOString();
  return [...latestByDriver.values()]
    .filter((pos) => pos.position > 0)
    .map((pos) => ({ ...pos, date: startIso }));
}

export function determineReplayStartTime(raceControl: OpenF1RaceControl[]): number {
  const sessionStarted = raceControl.find(
    (message) => message.category === 'SessionStatus' && message.message?.toUpperCase() === 'SESSION STARTED'
  );
  if (sessionStarted) {
    return new Date(sessionStarted.date).getTime();
  }

  const greenFlag = raceControl.find(
    (message) =>
      message.flag === 'GREEN' &&
      message.scope === 'Track' &&
      !message.message?.toLowerCase().includes('pit exit open')
  );
  if (greenFlag) {
    return new Date(greenFlag.date).getTime();
  }

  return 0;
}

export function buildReplayTimeline(input: ReplayTimelineInput): ReplayEvent[] {
  const startTime = determineReplayStartTime(input.raceControl);
  const lapCompletionTimestamps = buildLapCompletionTimestamps(input.laps);
  const gridSeedPositions = buildGridSeedPositions(input.positions, startTime);
  let sequence = 0;

  const events: ReplayEvent[] = [
    ...input.raceControl.map((event) => ({
      type: 'race_control' as const,
      timestamp: new Date(event.date).getTime(),
      sequence: sequence++,
      data: event,
    })),
    // Grid seed first so the correct leader is established at the race start,
    // before any post-start position changes (which override it) arrive.
    ...gridSeedPositions.map((event) => ({
      type: 'position' as const,
      timestamp: startTime,
      sequence: sequence++,
      data: event,
    })),
    ...input.positions.map((event) => ({
      type: 'position' as const,
      timestamp: new Date(event.date).getTime(),
      sequence: sequence++,
      data: event,
    })),
    ...input.intervals.map((event) => ({
      type: 'interval' as const,
      timestamp: new Date(event.date).getTime(),
      sequence: sequence++,
      data: event,
    })),
    ...input.pits.map((event) => ({
      type: 'pit' as const,
      timestamp: new Date(event.date).getTime(),
      sequence: sequence++,
      data: event,
    })),
    ...input.laps.map((event) => ({
      type: 'lap' as const,
      timestamp: lapCompletionTimestamps.get(event) ?? getLapCompletionTimestamp(event),
      sequence: sequence++,
      data: event,
    })),
  ]
    .filter((event) => Number.isFinite(event.timestamp) && event.timestamp >= startTime)
    .sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      if (typeOrder[a.type] !== typeOrder[b.type]) return typeOrder[a.type] - typeOrder[b.type];
      return a.sequence - b.sequence;
    });

  return events;
}

/** Shift timeline so the first event starts at t=0 (preserves inter-event deltas). */
export function normalizeTimelineToZero(events: ReplayEvent[]): ReplayEvent[] {
  if (events.length === 0) {
    return events;
  }

  const origin = events[0].timestamp;
  return events.map((event) => ({
    ...event,
    timestamp: event.timestamp - origin,
  }));
}

export function applyReplayEvent(snapshotStore: SnapshotStore, event: ReplayEvent): void {
  switch (event.type) {
    case 'race_control':
      snapshotStore.processRaceControlUpdate([event.data as OpenF1RaceControl]);
      break;
    case 'position':
      snapshotStore.processPositionUpdate([event.data as OpenF1Position]);
      break;
    case 'interval':
      snapshotStore.processIntervalUpdate([event.data as OpenF1Interval]);
      break;
    case 'pit':
      snapshotStore.processPitUpdate([event.data as OpenF1Pit]);
      break;
    case 'lap':
      snapshotStore.processLapCompletion(event.data as OpenF1Lap);
      break;
    default:
      break;
  }
}
