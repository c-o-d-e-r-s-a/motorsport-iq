import type { OpenF1Pit, OpenF1Stint } from '../types';

const VALID_COMPOUNDS = new Set(['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET']);

const COMPOUND_ALIASES: Record<string, string> = {
  S: 'SOFT',
  SOFT: 'SOFT',
  SS: 'SOFT',
  SUPERSOFT: 'SOFT',
  US: 'SOFT',
  ULTRASOFT: 'SOFT',
  HS: 'SOFT',
  HYPERSOFT: 'SOFT',
  M: 'MEDIUM',
  MEDIUM: 'MEDIUM',
  H: 'HARD',
  HARD: 'HARD',
  C1: 'HARD',
  C2: 'MEDIUM',
  C3: 'SOFT',
  C4: 'SOFT',
  C5: 'SOFT',
  I: 'INTERMEDIATE',
  INTER: 'INTERMEDIATE',
  INTERMEDIATE: 'INTERMEDIATE',
  W: 'WET',
  WET: 'WET',
};

export interface SignalRStintEntry {
  Compound?: string;
  TotalLaps?: number | string;
  New?: boolean | string;
  StartLaps?: number | string;
  LapFlags?: number | string;
  TyresNotChanged?: boolean | number | string;
}

export function normalizeCompound(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  const compound = String(raw).trim().toUpperCase();
  if (!compound || compound === 'UNKNOWN') {
    return null;
  }

  const mapped = COMPOUND_ALIASES[compound];
  if (mapped) {
    return mapped;
  }

  return VALID_COMPOUNDS.has(compound) ? compound : null;
}

function parsePositiveInt(raw: unknown): number | null {
  const parsed = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseNonNegativeNumber(raw: unknown): number | null {
  const parsed = parseFloat(String(raw ?? ''));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function isTruthyFlag(raw: unknown): boolean {
  return raw === true || raw === 'true' || raw === 1 || raw === '1';
}

function normalizeStintEntries(rawStints: unknown): Array<[string, SignalRStintEntry]> {
  if (Array.isArray(rawStints)) {
    return rawStints.map((entry, index) => [String(index), entry as SignalRStintEntry]);
  }

  if (rawStints && typeof rawStints === 'object') {
    return Object.entries(rawStints as Record<string, SignalRStintEntry>);
  }

  return [];
}

export function mapTimingAppDataToStints(
  lines: Record<string, { Stints?: unknown }> | undefined,
  timestamp: string
): OpenF1Stint[] {
  if (!lines) {
    return [];
  }

  const stints: OpenF1Stint[] = [];

  for (const [driverNumberStr, lineData] of Object.entries(lines)) {
    const driverNumber = parseInt(driverNumberStr, 10);
    if (!Number.isFinite(driverNumber)) {
      continue;
    }

    const stintEntries = normalizeStintEntries(lineData?.Stints);
    if (stintEntries.length === 0) {
      continue;
    }

    let nextLapStart = 1;

    for (let index = 0; index < stintEntries.length; index += 1) {
      const [stintKey, stintData] = stintEntries[index];
      const totalLaps = parsePositiveInt(stintData.TotalLaps);
      const compound = normalizeCompound(stintData.Compound);
      const isActiveStint = index === stintEntries.length - 1;

      if (totalLaps === null) {
        if (!isActiveStint || !compound) {
          continue;
        }

        stints.push({
          date: timestamp,
          session_key: 0,
          meeting_key: 0,
          driver_number: driverNumber,
          stint_number: parseInt(stintKey, 10) + 1,
          lap_start: nextLapStart,
          lap_end: null,
          compound,
          tyre_age_at_start: isTruthyFlag(stintData.New)
            ? 0
            : parseNonNegativeNumber(stintData.StartLaps) ?? 0,
        });
        continue;
      }

      const stintNumber = parseInt(stintKey, 10) + 1;
      const lapStart = nextLapStart;
      const lapEnd = isActiveStint ? null : lapStart + totalLaps - 1;

      if (!isActiveStint) {
        nextLapStart = lapStart + totalLaps;
      }

      stints.push({
        date: timestamp,
        session_key: 0,
        meeting_key: 0,
        driver_number: driverNumber,
        stint_number: stintNumber,
        lap_start: lapStart,
        lap_end: lapEnd,
        compound: normalizeCompound(stintData.Compound),
        tyre_age_at_start: isTruthyFlag(stintData.New)
          ? 0
          : parseNonNegativeNumber(stintData.StartLaps) ?? 0,
      });
    }
  }

  return stints;
}

export function extractActiveCompoundsFromTimingAppData(
  lines: Record<string, { Stints?: unknown }> | undefined
): Array<{ driverNumber: number; compound: string }> {
  if (!lines) {
    return [];
  }

  const compounds: Array<{ driverNumber: number; compound: string }> = [];

  for (const [driverNumberStr, lineData] of Object.entries(lines)) {
    const driverNumber = parseInt(driverNumberStr, 10);
    if (!Number.isFinite(driverNumber)) {
      continue;
    }

    const stintEntries = normalizeStintEntries(lineData?.Stints);
    if (stintEntries.length === 0) {
      continue;
    }

    const [, activeStintData] = stintEntries[stintEntries.length - 1];
    const compound = normalizeCompound(activeStintData.Compound);
    if (compound) {
      compounds.push({ driverNumber, compound });
    }
  }

  return compounds;
}

export interface PitStopDetectionInput {
  driverNumber: number;
  timestamp: string;
  lapNumber: number;
  lastKnownLap?: number | null;
  pitStopCount: number | null;
  inPit: boolean | null;
  previousPitStopCount: number;
  wasInPit: boolean;
}

export interface PitStopDetectionResult {
  pits: OpenF1Pit[];
  nextPitStopCount: number;
  nextWasInPit: boolean;
}

function resolvePitLapNumber(lapNumber: number, lastKnownLap: number | undefined): number | null {
  const effectiveLap = lapNumber > 1
    ? lapNumber
    : (lastKnownLap && lastKnownLap > 0 ? lastKnownLap : lapNumber);

  if (!Number.isFinite(effectiveLap) || effectiveLap <= 0) {
    return null;
  }

  return effectiveLap;
}

export function detectPitStopsFromTimingLine(input: PitStopDetectionInput): PitStopDetectionResult {
  const pits: OpenF1Pit[] = [];
  let nextPitStopCount = input.previousPitStopCount;
  let nextWasInPit = input.wasInPit;
  const resolvedLap = resolvePitLapNumber(input.lapNumber, input.lastKnownLap ?? undefined);

  if (resolvedLap === null) {
    return { pits, nextPitStopCount, nextWasInPit: input.inPit ?? input.wasInPit };
  }

  if (input.pitStopCount !== null && input.pitStopCount > input.previousPitStopCount) {
    for (let pitNumber = input.previousPitStopCount + 1; pitNumber <= input.pitStopCount; pitNumber += 1) {
      pits.push(createPitRecord(input.driverNumber, pitNumber, resolvedLap, input.timestamp, null));
    }
    nextPitStopCount = input.pitStopCount;
  }

  if (input.inPit !== null) {
    if (input.inPit) {
      nextWasInPit = true;
    } else if (input.wasInPit && pits.length === 0) {
      const fallbackCount = input.pitStopCount ?? input.previousPitStopCount + 1;
      if (fallbackCount > input.previousPitStopCount) {
        for (let pitNumber = input.previousPitStopCount + 1; pitNumber <= fallbackCount; pitNumber += 1) {
          pits.push(createPitRecord(input.driverNumber, pitNumber, resolvedLap, input.timestamp, null));
        }
        nextPitStopCount = fallbackCount;
      }
      nextWasInPit = false;
    } else if (!input.inPit) {
      nextWasInPit = false;
    }
  }

  return { pits, nextPitStopCount, nextWasInPit };
}

function createPitRecord(
  driverNumber: number,
  pitNumber: number,
  lapNumber: number,
  timestamp: string,
  pitDuration: number | null
): OpenF1Pit {
  return {
    date: timestamp,
    session_key: 0,
    meeting_key: 0,
    driver_number: driverNumber,
    pit_duration: pitDuration ?? 0,
    lap_number: lapNumber > 0 ? lapNumber : 1,
    number: pitNumber,
  };
}

export function mapPitLaneTimeCollectionToPits(
  payload: unknown,
  timestamp: string,
  lastPitNumberByDriver: ReadonlyMap<number, number>,
  lapNumberByDriver: ReadonlyMap<number, number>
): OpenF1Pit[] {
  const pits: OpenF1Pit[] = [];
  const candidateGroups = collectPitLaneGroups(payload);

  for (const group of candidateGroups) {
    const driverNumber = parsePositiveInt(group.driverNumber);
    if (driverNumber === null) {
      continue;
    }

    const pitNumber = parsePositiveInt(group.pitNumber) ?? (lastPitNumberByDriver.get(driverNumber) ?? 0) + 1;
    if (pitNumber <= (lastPitNumberByDriver.get(driverNumber) ?? 0)) {
      continue;
    }

    const lapNumber = parsePositiveInt(group.lapNumber) ?? lapNumberByDriver.get(driverNumber) ?? 1;
    const pitDuration = parseNonNegativeNumber(group.pitDuration);

    pits.push(createPitRecord(driverNumber, pitNumber, lapNumber, timestamp, pitDuration));
  }

  return pits;
}

interface PitLaneCandidate {
  driverNumber?: unknown;
  pitNumber?: unknown;
  lapNumber?: unknown;
  pitDuration?: unknown;
}

function collectPitLaneGroups(payload: unknown): PitLaneCandidate[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const groups: PitLaneCandidate[] = [];
  const root = payload as Record<string, unknown>;

  if (root.Lines && typeof root.Lines === 'object') {
    for (const [driverNumber, lineData] of Object.entries(root.Lines as Record<string, unknown>)) {
      appendPitLaneCandidates(groups, lineData, driverNumber);
    }
  }

  if (Array.isArray(root.PitTimes)) {
    for (const entry of root.PitTimes) {
      appendPitLaneCandidates(groups, entry);
    }
  }

  if (Array.isArray(root.PitStops)) {
    for (const entry of root.PitStops) {
      appendPitLaneCandidates(groups, entry);
    }
  }

  appendPitLaneCandidates(groups, root);

  return groups;
}

function appendPitLaneCandidates(
  groups: PitLaneCandidate[],
  source: unknown,
  driverNumberOverride?: string
): void {
  if (!source || typeof source !== 'object') {
    return;
  }

  const record = source as Record<string, unknown>;
  const nestedCollections = ['PitTimes', 'PitStops', 'Stops', 'Entries'];

  for (const key of nestedCollections) {
    const nested = record[key];
    if (Array.isArray(nested)) {
      for (const entry of nested) {
        appendPitLaneCandidates(groups, entry, driverNumberOverride);
      }
    }
  }

  const driverNumber = record.RacingNumber
    ?? record.DriverNumber
    ?? record.driver_number
    ?? driverNumberOverride;
  const pitDuration = record.PitStop
    ?? record.StopDuration
    ?? record.PitStopDuration
    ?? record.Duration
    ?? record.Time;
  const lapNumber = record.Lap ?? record.LapNumber ?? record.lap_number;
  const pitNumber = record.Number ?? record.PitStopNumber ?? record.StopNumber ?? record.number;

  if (driverNumber !== undefined && (pitDuration !== undefined || lapNumber !== undefined || pitNumber !== undefined)) {
    groups.push({ driverNumber, pitNumber, lapNumber, pitDuration });
  }
}
