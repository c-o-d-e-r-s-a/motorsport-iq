import type { DriverState, RaceSnapshot, QuestionInstanceState } from '../types';
import { resolveQuestion, shouldResolve } from './resolutionEngine';

function createDriver(overrides: Partial<DriverState> = {}): DriverState {
  return {
    driverNumber: 18,
    name: 'Lance Stroll',
    team: 'Aston Martin',
    position: 22,
    gap: 30.0,
    interval: 0.5,
    tyreCompound: 'HARD',
    tyreAge: 24,
    stintNumber: 2,
    overtakeModeArmed: false,
    pitCount: 1,
    lastLapTime: 92.0,
    inPit: false,
    retired: false,
    ...overrides,
  };
}

function createSnapshot(drivers: DriverState[], overrides: Partial<RaceSnapshot> = {}): RaceSnapshot {
  return {
    sessionId: 'session-1',
    lapNumber: 28,
    totalLaps: 66,
    trackStatus: 'GREEN',
    sessionMode: 'replay',
    replaySpeed: 10,
    isReplayComplete: false,
    drivers,
    timestamp: new Date('2026-06-01T12:00:00Z'),
    dataFeedStalled: false,
    leaderLapTime: 90.5,
    leaderLapStartTime: '2026-06-01T11:58:30Z',
    localYellowSectors: [],
    globalYellowActive: false,
    ...overrides,
  };
}

function createInstance(driver1: DriverState, overrides: Partial<QuestionInstanceState> = {}): QuestionInstanceState {
  const triggerSnapshot = createSnapshot([driver1], { lapNumber: 25 });
  return {
    id: 'inst-1',
    lobbyId: 'lobby-1',
    questionId: 'PIT_STOP_NEXT_3',
    state: 'ACTIVE',
    triggeredAt: new Date('2026-06-01T11:59:00Z'),
    triggerSnapshot,
    windowSize: 3,
    targetLap: 28,
    answer: null,
    outcome: null,
    driver1,
    ...overrides,
  };
}

describe('resolutionEngine — retired driver hard rule', () => {
  it('resolves instantly as NO when the subject driver has retired', () => {
    const triggerDriver = createDriver({ retired: false });
    const instance = createInstance(triggerDriver);

    const retiredSnapshot = createSnapshot([createDriver({ retired: true })]);
    const result = resolveQuestion(instance, retiredSnapshot);

    expect(result.outcome).toBe(false);
    expect(result.correctAnswer).toBe('NO');
    expect(result.explanation).toContain('out of the race');
  });

  it('flags a retired subject driver for early resolution before the target lap', () => {
    const triggerDriver = createDriver({ retired: false });
    const instance = createInstance(triggerDriver, { targetLap: 40 });

    const earlySnapshot = createSnapshot([createDriver({ retired: true })], { lapNumber: 30 });
    expect(shouldResolve(instance, earlySnapshot)).toBe(true);
  });

  it('does not force NO while the subject driver is still running', () => {
    const triggerDriver = createDriver({ retired: false });
    const instance = createInstance(triggerDriver);

    const runningSnapshot = createSnapshot([createDriver({ retired: false, tyreAge: 27 })]);
    const result = resolveQuestion(instance, runningSnapshot);

    // PIT_STOP_NEXT_3 success = driver pitted; with no pit it should be NO, but
    // crucially not via the retirement short-circuit (explanation differs).
    expect(result.explanation).not.toContain('out of the race');
  });
});

describe('resolutionEngine — final stretch timing', () => {
  it('does not resolve a finish-position question when the final lap begins', () => {
    const triggerDriver = createDriver({ position: 2, interval: 1.2 });
    const rival = createDriver({ driverNumber: 44, name: 'Leader', position: 1, gap: 0, interval: null });
    const instance = createInstance(triggerDriver, {
      questionId: 'FIN_AHEAD_OF_RIVAL',
      targetLap: 30,
      driver2: rival,
    });

    const finalLapStart = createSnapshot(
      [rival, triggerDriver],
      { lapNumber: 30, totalLaps: 30, trackStatus: 'GREEN' }
    );

    expect(shouldResolve(instance, finalLapStart)).toBe(false);
  });

  it('resolves a finish-position question after the final lap completes', () => {
    const triggerDriver = createDriver({ position: 2, interval: 1.2 });
    const rival = createDriver({ driverNumber: 44, name: 'Leader', position: 1, gap: 0, interval: null });
    const instance = createInstance(triggerDriver, {
      questionId: 'FIN_AHEAD_OF_RIVAL',
      targetLap: 30,
      driver2: rival,
    });

    const afterFinalLap = createSnapshot(
      [rival, triggerDriver],
      { lapNumber: 31, totalLaps: 30, trackStatus: 'GREEN' }
    );

    expect(shouldResolve(instance, afterFinalLap)).toBe(true);
  });

  it('resolves a finish-position question on the chequered flag', () => {
    const triggerDriver = createDriver({ position: 2, interval: 1.2 });
    const instance = createInstance(triggerDriver, {
      questionId: 'FIN_AHEAD_OF_RIVAL',
      targetLap: 30,
    });

    const chequered = createSnapshot([createDriver({ position: 1 })], {
      lapNumber: 30,
      totalLaps: 30,
      trackStatus: 'CHEQUERED',
    });

    expect(shouldResolve(instance, chequered)).toBe(true);
  });
});
