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

function getLapTimestamp(lap: OpenF1Lap): string {
  if (lap.date_start && lap.lap_duration) {
    return new Date(new Date(lap.date_start).getTime() + lap.lap_duration * 1000).toISOString();
  }
  return lap.date_start;
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
  let sequence = 0;

  const events: ReplayEvent[] = [
    ...input.raceControl.map((event) => ({
      type: 'race_control' as const,
      timestamp: new Date(event.date).getTime(),
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
      timestamp: new Date(getLapTimestamp(event)).getTime(),
      sequence: sequence++,
      data: event,
    })),
  ]
    .filter((event) => event.timestamp >= startTime)
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
