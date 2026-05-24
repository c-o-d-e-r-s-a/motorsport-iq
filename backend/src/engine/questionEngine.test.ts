import type { DriverState, RaceSnapshot, QuestionInstanceState } from '../types';
import { clearCooldowns, recordResolution, selectQuestion } from './questionEngine';
import { generateQuestionText } from '../ai/explanationGenerator';

function createDriver(overrides: Partial<DriverState> = {}): DriverState {
  return {
    driverNumber: 1,
    name: 'Driver A',
    team: 'Team A',
    position: 2,
    gap: 5.2,
    interval: 1.2,
    tyreCompound: 'MEDIUM',
    tyreAge: 16,
    stintNumber: null,
    drsEnabled: true,
    pitCount: 0,
    lastLapTime: 91.2,
    inPit: false,
    retired: false,
    ...overrides,
  };
}

function createSnapshot(overrides: Partial<RaceSnapshot> = {}): RaceSnapshot {
  const defaultDrivers = [
    createDriver({
      driverNumber: 44,
      name: 'Leader',
      team: 'Team L',
      position: 1,
      gap: 0,
      interval: null,
      tyreAge: 12,
      drsEnabled: false,
    }),
    createDriver(),
    createDriver({
      driverNumber: 16,
      name: 'Driver B',
      team: 'Team B',
      position: 3,
      gap: 6.4,
      interval: 1.2,
      tyreAge: 14,
      drsEnabled: false,
    }),
  ];

  return {
    sessionId: 'session-1',
    lapNumber: 10,
    totalLaps: 50,
    trackStatus: 'GREEN',
    sessionMode: 'live',
    replaySpeed: null,
    isReplayComplete: false,
    drivers: defaultDrivers,
    timestamp: new Date('2026-03-13T12:00:00Z'),
    dataFeedStalled: false,
    leaderLapTime: 90.5,
    leaderLapStartTime: '2026-03-13T11:58:30Z',
    ...overrides,
  };
}

describe('questionEngine MVP guardrails', () => {
  const lobbyId = 'lobby-test';

  beforeEach(() => {
    clearCooldowns(lobbyId);
  });

  afterEach(() => {
    clearCooldowns(lobbyId);
  });

  it('does not trigger on laps 1 through 3', () => {
    const snapshot = createSnapshot({ lapNumber: 3 });
    const previous = createSnapshot({ lapNumber: 2 });

    expect(selectQuestion(snapshot, previous, lobbyId, null, 0)).toBeNull();
  });

  it('does not trigger under safety car conditions', () => {
    const snapshot = createSnapshot({ trackStatus: 'SC' });
    const previous = createSnapshot({ lapNumber: 9 });

    expect(selectQuestion(snapshot, previous, lobbyId, null, 0)).toBeNull();
  });

  it('enforces one-lap restart cooldown after non-green running', () => {
    const restartLap = createSnapshot({ lapNumber: 12, trackStatus: 'GREEN' });
    const previousUnderSc = createSnapshot({ lapNumber: 11, trackStatus: 'SC' });
    const oneLapLater = createSnapshot({ lapNumber: 13, trackStatus: 'GREEN' });
    const twoLapsLater = createSnapshot({ lapNumber: 14, trackStatus: 'GREEN' });

    expect(selectQuestion(restartLap, previousUnderSc, lobbyId, null, 0)).toBeNull();
    expect(selectQuestion(oneLapLater, restartLap, lobbyId, null, 0)).toBeNull();
    expect(selectQuestion(twoLapsLater, oneLapLater, lobbyId, null, 0)).not.toBeNull();
  });

  it('prevents back-to-back questions from the same category', () => {
    const snapshot = createSnapshot();
    const previous = createSnapshot({
      lapNumber: 9,
      drivers: [
        createDriver({
          driverNumber: 44,
          name: 'Leader',
          team: 'Team L',
          position: 1,
          gap: 0,
          interval: null,
          tyreAge: 11,
          drsEnabled: false,
        }),
        createDriver({
          interval: 2.0,
          tyreAge: 15,
          lastLapTime: 91.8,
        }),
        createDriver({
          driverNumber: 16,
          name: 'Driver B',
          team: 'Team B',
          position: 3,
          gap: 7.2,
          interval: 1.1,
          tyreAge: 13,
          drsEnabled: false,
        }),
      ],
    });

    const first = selectQuestion(snapshot, previous, lobbyId, null, 0);
    expect(first?.questionId.startsWith('OVR_')).toBe(true);

    recordResolution(lobbyId, 'OVERTAKE', 10);

    const nextSnapshot = createSnapshot({ lapNumber: 12 });
    const nextPrevious = createSnapshot({ lapNumber: 11 });
    const second = selectQuestion(nextSnapshot, nextPrevious, lobbyId, null, 1);
    expect(second?.questionId.startsWith('OVR_')).toBe(false);
  });

  it('enforces a two-lap cooldown after resolution', () => {
    recordResolution(lobbyId, 'OVERTAKE', 10);

    expect(selectQuestion(createSnapshot({ lapNumber: 11 }), createSnapshot({ lapNumber: 10 }), lobbyId, null, 1)).toBeNull();
    expect(selectQuestion(createSnapshot({ lapNumber: 12 }), createSnapshot({ lapNumber: 11 }), lobbyId, null, 1)).not.toBeNull();
  });

  it('does not exceed the maximum race question cap', () => {
    const snapshot = createSnapshot();
    const previous = createSnapshot({ lapNumber: 9 });

    expect(selectQuestion(snapshot, previous, lobbyId, null, 10)).toBeNull();
  });

  it('can select a replay question when current lap is below the actual race distance', () => {
    const snapshot = createSnapshot({
      sessionMode: 'replay',
      replaySpeed: 10,
      lapNumber: 4,
      totalLaps: 58,
      drivers: [
        createDriver({
          driverNumber: 44,
          name: 'Leader',
          team: 'Team L',
          position: 1,
          gap: 0,
          interval: null,
          tyreAge: 12,
          drsEnabled: false,
        }),
        createDriver({
          driverNumber: 81,
          name: 'Driver A',
          position: 2,
          gap: 3.2,
          interval: 0.8,
          tyreAge: 14,
          drsEnabled: true,
        }),
        createDriver({
          driverNumber: 16,
          name: 'Driver B',
          team: 'Team B',
          position: 3,
          gap: 4.0,
          interval: 0.8,
          tyreAge: 13,
          drsEnabled: false,
        }),
      ],
    });
    const previous = createSnapshot({
      sessionMode: 'replay',
      replaySpeed: 10,
      lapNumber: 3,
      totalLaps: 58,
      drivers: [
        createDriver({
          driverNumber: 44,
          name: 'Leader',
          team: 'Team L',
          position: 1,
          gap: 0,
          interval: null,
          tyreAge: 11,
          drsEnabled: false,
        }),
        createDriver({
          driverNumber: 81,
          name: 'Driver A',
          position: 2,
          gap: 3.8,
          interval: 1.4,
          tyreAge: 13,
          drsEnabled: true,
        }),
        createDriver({
          driverNumber: 16,
          name: 'Driver B',
          team: 'Team B',
          position: 3,
          gap: 5.2,
          interval: 1.4,
          tyreAge: 12,
          drsEnabled: false,
        }),
      ],
    });

    const question = selectQuestion(snapshot, previous, lobbyId, null, 0);
    expect(question).not.toBeNull();
  });

  it('falls back to deterministic question text when AI is unavailable', async () => {
    const instance: QuestionInstanceState = {
      id: 'instance-1',
      lobbyId,
      questionId: 'OVR_PASS_NEXT_3',
      state: 'TRIGGERED',
      triggeredAt: new Date(),
      triggerSnapshot: createSnapshot(),
      windowSize: 3,
      targetLap: 13,
      answer: null,
      outcome: null,
      driver1: createDriver({ name: 'Lando Norris' }),
      driver2: createDriver({ driverNumber: 4, name: 'Charles Leclerc', position: 1, interval: null }),
    };

    await expect(generateQuestionText(instance)).resolves.toBe('Will Lando Norris overtake Charles Leclerc in the next 3 laps?');
  });
});
