import {
  detectPitStopsFromTimingLine,
  extractActiveCompoundsFromTimingAppData,
  mapPitLaneTimeCollectionToPits,
  mapTimingAppDataToStints,
  normalizeCompound,
} from './f1SignalRPitStintMapper';

describe('f1SignalRPitStintMapper', () => {
  it('maps TimingAppData stints with cumulative lap windows', () => {
    const stints = mapTimingAppDataToStints(
      {
        '1': {
          Stints: {
            '0': { Compound: 'SOFT', TotalLaps: 18, New: true },
            '1': { Compound: 'MEDIUM', TotalLaps: 6, New: true },
          },
        },
      },
      '2026-05-24T18:30:00.000Z'
    );

    expect(stints).toEqual([
      expect.objectContaining({
        driver_number: 1,
        stint_number: 1,
        lap_start: 1,
        lap_end: 18,
        compound: 'SOFT',
        tyre_age_at_start: 0,
      }),
      expect.objectContaining({
        driver_number: 1,
        stint_number: 2,
        lap_start: 19,
        lap_end: null,
        compound: 'MEDIUM',
      }),
    ]);
  });

  it('supports TimingAppData stint arrays at session start', () => {
    const stints = mapTimingAppDataToStints(
      {
        '44': {
          Stints: [{ Compound: 'HARD', TotalLaps: 12, New: 'true' }],
        },
      },
      '2026-05-24T18:30:00.000Z'
    );

    expect(stints).toHaveLength(1);
    expect(stints[0]).toMatchObject({
      driver_number: 44,
      stint_number: 1,
      lap_start: 1,
      lap_end: null,
      compound: 'HARD',
    });
  });

  it('maps carried-over tyres from StartLaps when New is false', () => {
    const stints = mapTimingAppDataToStints(
      {
        '16': {
          Stints: [{ Compound: 'MEDIUM', TotalLaps: 12, New: false, StartLaps: 7 }],
        },
      },
      '2026-05-24T18:30:00.000Z'
    );

    expect(stints).toHaveLength(1);
    expect(stints[0]).toMatchObject({
      driver_number: 16,
      compound: 'MEDIUM',
      tyre_age_at_start: 7,
    });
  });

  it('detects pit stops from NumberOfPitStops increments', () => {
    const result = detectPitStopsFromTimingLine({
      driverNumber: 16,
      timestamp: '2026-05-24T18:35:00.000Z',
      lapNumber: 21,
      pitStopCount: 2,
      inPit: null,
      previousPitStopCount: 1,
      wasInPit: false,
    });

    expect(result.pits).toHaveLength(1);
    expect(result.pits[0]).toMatchObject({
      driver_number: 16,
      number: 2,
      lap_number: 21,
    });
    expect(result.nextPitStopCount).toBe(2);
  });

  it('falls back to InPit transitions when pit stop count is missing', () => {
    const result = detectPitStopsFromTimingLine({
      driverNumber: 4,
      timestamp: '2026-05-24T18:36:00.000Z',
      lapNumber: 14,
      pitStopCount: null,
      inPit: false,
      previousPitStopCount: 0,
      wasInPit: true,
    });

    expect(result.pits).toHaveLength(1);
    expect(result.pits[0]).toMatchObject({
      driver_number: 4,
      number: 1,
      lap_number: 14,
    });
    expect(result.nextWasInPit).toBe(false);
  });

  it('maps PitLaneTimeCollection entries into pit records', () => {
    const pits = mapPitLaneTimeCollectionToPits(
      {
        Lines: {
          '63': {
            PitTimes: [{ Lap: 18, PitStop: '2.4', Number: 1 }],
          },
        },
      },
      '2026-05-24T18:40:00.000Z',
      new Map(),
      new Map([[63, 18]])
    );

    expect(pits).toHaveLength(1);
    expect(pits[0]).toMatchObject({
      driver_number: 63,
      number: 1,
      lap_number: 18,
      pit_duration: 2.4,
    });
  });

  it('normalizes C1/C2/C3 compound codes', () => {
    expect(normalizeCompound('C1')).toBe('HARD');
    expect(normalizeCompound('c2')).toBe('MEDIUM');
    expect(normalizeCompound('C3')).toBe('SOFT');
  });

  it('extracts active stint compounds from TimingAppData lines', () => {
    const compounds = extractActiveCompoundsFromTimingAppData({
      '1': {
        Stints: {
          '0': { Compound: 'SOFT', TotalLaps: 18, New: true },
          '1': { Compound: 'MEDIUM', TotalLaps: 6, New: true },
        },
      },
      '44': {
        Stints: [{ Compound: 'HARD', TotalLaps: 12, New: 'true' }],
      },
    });

    expect(compounds).toEqual([
      { driverNumber: 1, compound: 'MEDIUM' },
      { driverNumber: 44, compound: 'HARD' },
    ]);
  });
});
