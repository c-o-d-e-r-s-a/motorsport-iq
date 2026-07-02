import type { OpenF1RaceControl, RaceSnapshot, TrackStatus } from '../types';
import {
  applyReplayTrackStatusTransition,
  isRaceNeutralized,
  messageTime,
} from './raceStatus';

const SC_SLOWDOWN_RATIO = 1.45;
const VSC_SLOWDOWN_RATIO = 1.1;
const MIN_DRIVERS_WITH_LAP_TIME = 5;
const MIN_GREEN_MEDIAN_SAMPLES = 2;
const MAX_GREEN_MEDIAN_SAMPLES = 8;
/** Consecutive laps without slower pace before clearing a false neutralization. */
const UNCORROBORATED_LAP_LIMIT = 2;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function fieldMedianLapTime(snapshot: RaceSnapshot): number | null {
  const times = snapshot.drivers
    .filter((driver) => !driver.retired && !driver.inPit && driver.lastLapTime != null && driver.lastLapTime > 60)
    .map((driver) => driver.lastLapTime as number);

  if (times.length < MIN_DRIVERS_WITH_LAP_TIME) {
    return null;
  }

  return median(times);
}

function greenBaselineMedian(samples: number[]): number | null {
  if (samples.length < MIN_GREEN_MEDIAN_SAMPLES) {
    return null;
  }
  return median(samples);
}

function telemetrySupportsNeutralization(
  status: 'SC' | 'VSC',
  lapMedian: number,
  baseline: number
): boolean {
  const ratio = lapMedian / baseline;
  return status === 'SC' ? ratio >= SC_SLOWDOWN_RATIO : ratio >= VSC_SLOWDOWN_RATIO;
}

/**
 * Replay-only track status controller.
 *
 * Layer 2 — chronological state machine: each race-control message applies an
 * explicit transition instead of re-deriving status from the newest substring
 * match across full history.
 *
 * Layer 3 — telemetry corroboration: if SC/VSC stays active but field lap pace
 * remains at green speed for multiple laps, the neutralization is treated as
 * a false positive and cleared.
 */
export class ReplayTrackStatusController {
  private status: TrackStatus = 'GREEN';
  private lastMessageTime = 0;
  private greenMedianSamples: number[] = [];
  private uncorroboratedLaps = 0;

  getStatus(): TrackStatus {
    return this.status;
  }

  reset(): void {
    this.status = 'GREEN';
    this.lastMessageTime = 0;
    this.greenMedianSamples = [];
    this.uncorroboratedLaps = 0;
  }

  /**
   * Apply race-control messages in time order. Returns the new track status
   * when it changed, otherwise null.
   */
  processMessages(messages: OpenF1RaceControl[]): TrackStatus | null {
    if (messages.length === 0) {
      return null;
    }

    const ordered = [...messages].sort(
      (a, b) => messageTime(a) - messageTime(b)
    );

    const previous = this.status;
    for (const message of ordered) {
      const time = messageTime(message);
      if (time > 0 && time < this.lastMessageTime) {
        continue;
      }

      const next = applyReplayTrackStatusTransition(this.status, message);
      if (next === null || next === this.status) {
        continue;
      }

      if (time > 0) {
        this.lastMessageTime = Math.max(this.lastMessageTime, time);
      }

      this.status = next;
      if (next === 'SC' || next === 'VSC') {
        this.uncorroboratedLaps = 0;
      }
    }

    return this.status !== previous ? this.status : null;
  }

  /**
   * Reject neutralizations that are not reflected in field lap pace.
   * Returns GREEN when a false SC/VSC is cleared, otherwise null.
   */
  onLapComplete(snapshot: RaceSnapshot): TrackStatus | null {
    const lapMedian = fieldMedianLapTime(snapshot);
    const baseline = greenBaselineMedian(this.greenMedianSamples);

    if (!isRaceNeutralized(this.status)) {
      if (lapMedian !== null) {
        this.recordGreenSample(lapMedian);
      }
      return null;
    }

    if (this.status !== 'SC' && this.status !== 'VSC') {
      return null;
    }

    if (lapMedian !== null && baseline !== null) {
      if (telemetrySupportsNeutralization(this.status, lapMedian, baseline)) {
        this.uncorroboratedLaps = 0;
        return null;
      }
    }

    this.uncorroboratedLaps += 1;
    if (this.uncorroboratedLaps >= UNCORROBORATED_LAP_LIMIT) {
      this.status = 'GREEN';
      this.uncorroboratedLaps = 0;
      return 'GREEN';
    }

    return null;
  }

  private recordGreenSample(lapMedian: number): void {
    this.greenMedianSamples.push(lapMedian);
    if (this.greenMedianSamples.length > MAX_GREEN_MEDIAN_SAMPLES) {
      this.greenMedianSamples.shift();
    }
  }
}
