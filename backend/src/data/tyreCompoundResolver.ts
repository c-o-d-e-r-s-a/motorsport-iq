import type { OpenF1Stint } from '../types';

export interface TyreCompoundSource {
  stints: OpenF1Stint[];
  latestCompound: string | null;
}

function sortStintsByRecency(stints: OpenF1Stint[]): OpenF1Stint[] {
  return [...stints].sort((a, b) => {
    const aLapStart = a.lap_start ?? Number.MIN_SAFE_INTEGER;
    const bLapStart = b.lap_start ?? Number.MIN_SAFE_INTEGER;
    if (aLapStart !== bLapStart) {
      return bLapStart - aLapStart;
    }
    return b.stint_number - a.stint_number;
  });
}

export function findMostRecentStintCompound(stints: OpenF1Stint[]): string | null {
  for (const stint of sortStintsByRecency(stints)) {
    const compound = stint.compound?.trim();
    if (compound) {
      return compound;
    }
  }
  return null;
}

export function resolveTyreCompound(
  source: TyreCompoundSource,
  activeStint: OpenF1Stint | null
): string | null {
  const activeCompound = activeStint?.compound?.trim() || null;
  if (activeCompound) {
    return activeCompound;
  }

  const latestCompound = source.latestCompound?.trim() || null;
  if (latestCompound) {
    return latestCompound;
  }

  // Fallback only across the active stint and EARLIER stints. Borrowing a
  // FUTURE stint's compound (e.g. showing HARD during an early stint whose
  // compound OpenF1 left blank, because the driver later switched to HARD)
  // reports a tyre the driver is not yet on. Never surface a compound the
  // driver hasn't fitted at the current point in the race.
  const candidateStints = activeStint
    ? source.stints.filter((stint) => stint.stint_number <= activeStint.stint_number)
    : source.stints;

  return findMostRecentStintCompound(candidateStints);
}

export function mergeStintRecords(existing: OpenF1Stint, incoming: OpenF1Stint): OpenF1Stint {
  return {
    ...incoming,
    compound: incoming.compound ?? existing.compound,
    // Preserve a valid lap_start from the existing record so that a subsequent
    // stale/partial update with lap_start=null does not reset the tyre-age
    // calculation and cause the displayed age to jump back to the raw lap count.
    lap_start: incoming.lap_start ?? existing.lap_start,
    // Similarly preserve tyre_age_at_start so the current-stint age is stable.
    tyre_age_at_start: incoming.tyre_age_at_start ?? existing.tyre_age_at_start,
  };
}
