import {
  findMostRecentStintCompound,
  mergeStintRecords,
  resolveTyreCompound,
} from './tyreCompoundResolver';
import type { OpenF1Stint } from '../types';

function createStint(overrides: Partial<OpenF1Stint> = {}): OpenF1Stint {
  return {
    date: '2025-09-01T13:05:00Z',
    session_key: 1001,
    meeting_key: 2001,
    driver_number: 1,
    stint_number: 1,
    lap_start: 1,
    lap_end: null,
    compound: 'SOFT',
    tyre_age_at_start: 0,
    ...overrides,
  };
}

describe('tyreCompoundResolver', () => {
  it('prefers active stint compound over latestCompound and older stints', () => {
    const activeStint = createStint({ stint_number: 2, lap_start: 20, compound: 'MEDIUM' });

    expect(resolveTyreCompound(
      {
        latestCompound: 'HARD',
        stints: [
          createStint({ stint_number: 1, lap_start: 1, lap_end: 19, compound: 'SOFT' }),
          activeStint,
        ],
      },
      activeStint
    )).toBe('MEDIUM');
  });

  it('falls back to latestCompound when active stint has no compound', () => {
    const activeStint = createStint({ stint_number: 2, lap_start: 20, compound: null });

    expect(resolveTyreCompound(
      { latestCompound: 'HARD', stints: [activeStint] },
      activeStint
    )).toBe('HARD');
  });

  it('falls back to the most recent stint with a compound', () => {
    const activeStint = createStint({ stint_number: 2, lap_start: 20, compound: null });

    expect(resolveTyreCompound(
      {
        latestCompound: null,
        stints: [
          createStint({ stint_number: 1, lap_start: 1, lap_end: 19, compound: 'SOFT' }),
          activeStint,
        ],
      },
      activeStint
    )).toBe('SOFT');
  });

  it('surfaces the nearest known compound when the active opening stint is blank', () => {
    // Mirrors OpenF1 leaving an opening stint's compound blank (e.g. Russell,
    // Australian GP 2026) while a later stint is HARD. With nothing else known,
    // showing the nearest real tyre is far better UX for the leader card than a
    // blank dash, so the resolver falls back to the only known compound.
    const activeStint = createStint({ stint_number: 1, lap_start: 1, lap_end: 11, compound: null });

    expect(resolveTyreCompound(
      {
        latestCompound: null,
        stints: [
          activeStint,
          createStint({ stint_number: 2, lap_start: 12, lap_end: 58, compound: 'HARD' }),
        ],
      },
      activeStint
    )).toBe('HARD');
  });

  it('finds the latest stint by lap_start when resolving historical compounds', () => {
    expect(findMostRecentStintCompound([
      createStint({ stint_number: 1, lap_start: 1, compound: 'SOFT' }),
      createStint({ stint_number: 2, lap_start: 20, compound: 'MEDIUM' }),
    ])).toBe('MEDIUM');
  });

  it('preserves existing compound when merging stint updates without compound', () => {
    const existing = createStint({ compound: 'SOFT' });
    const incoming = createStint({ compound: null, lap_end: 19 });

    expect(mergeStintRecords(existing, incoming)).toMatchObject({
      compound: 'SOFT',
      lap_end: 19,
    });
  });
});
