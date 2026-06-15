import type { DriverState, RaceSnapshot, QuestionInstanceState } from '../types';
import {
  clearCooldowns,
  getPacingMinimumQuestionCount,
  getPacingTargetQuestionCount,
  getPacingState,
  getTiersToTry,
  isPlausibleCandidate,
  MAX_QUESTIONS_PER_RACE,
  recordResolution,
  selectQuestion,
  selectQuestionWithMeta,
} from './questionEngine';
import { generateQuestionText } from '../ai/explanationGenerator';
import { getQuestionById } from './questionBank';

// Re-export gather helper for tests — use internal gather via selectQuestionWithMeta tests
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
    overtakeModeArmed: false,
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
      overtakeModeArmed: false,
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
      overtakeModeArmed: false,
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
          overtakeModeArmed: false,
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
          overtakeModeArmed: false,
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

  it('does not exceed the maximum race question cap at 15', () => {
    const snapshot = createSnapshot();
    const previous = createSnapshot({ lapNumber: 9 });

    expect(selectQuestion(snapshot, previous, lobbyId, null, 15)).toBeNull();
  });

  it('remains eligible below the maximum cap at 14', () => {
    const snapshot = createSnapshot();
    const previous = createSnapshot({ lapNumber: 9 });

    expect(selectQuestion(snapshot, previous, lobbyId, null, 14)).not.toBeNull();
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
          overtakeModeArmed: false,
        }),
        createDriver({
          driverNumber: 81,
          name: 'Driver A',
          position: 2,
          gap: 3.2,
          interval: 0.8,
          tyreAge: 14,
          overtakeModeArmed: false,
        }),
        createDriver({
          driverNumber: 16,
          name: 'Driver B',
          team: 'Team B',
          position: 3,
          gap: 4.0,
          interval: 0.8,
          tyreAge: 13,
          overtakeModeArmed: false,
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
          overtakeModeArmed: false,
        }),
        createDriver({
          driverNumber: 81,
          name: 'Driver A',
          position: 2,
          gap: 3.8,
          interval: 1.4,
          tyreAge: 13,
          overtakeModeArmed: false,
        }),
        createDriver({
          driverNumber: 16,
          name: 'Driver B',
          team: 'Team B',
          position: 3,
          gap: 5.2,
          interval: 1.4,
          tyreAge: 12,
          overtakeModeArmed: false,
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

    await expect(generateQuestionText(instance)).resolves.toBe('Battle brewing — will Lando Norris get past Charles Leclerc in the next 3 laps?');
  });
});

describe('question pacing', () => {
  const lobbyId = 'pacing-test';

  beforeEach(() => {
    clearCooldowns(lobbyId);
  });

  afterEach(() => {
    clearCooldowns(lobbyId);
  });

  it('escalates from strict to tier1 when only relaxed closing trend matches', () => {
    const previous = createSnapshot({
      lapNumber: 9,
      totalLaps: 20,
      drivers: [
        createDriver({ driverNumber: 44, name: 'Leader', position: 1, gap: 0, interval: null, tyreAge: 8 }),
        createDriver({ driverNumber: 81, name: 'Chaser', position: 2, gap: 4, interval: 2.0, tyreAge: 8 }),
        createDriver({ driverNumber: 16, name: 'Driver B', position: 3, gap: 6, interval: 2.0, tyreAge: 8 }),
      ],
    });
    const snapshot = createSnapshot({
      lapNumber: 10,
      totalLaps: 20,
      drivers: [
        createDriver({ driverNumber: 44, name: 'Leader', position: 1, gap: 0, interval: null, tyreAge: 8 }),
        createDriver({ driverNumber: 81, name: 'Chaser', position: 2, gap: 3.92, interval: 1.92, tyreAge: 8 }),
        createDriver({ driverNumber: 16, name: 'Driver B', position: 3, gap: 6, interval: 2.0, tyreAge: 8 }),
      ],
    });

    const result = selectQuestionWithMeta(snapshot, previous, lobbyId, null, 2);
    expect(result.instance).not.toBeNull();
    expect(result.tier).toBe('tier1');
  });

  it('rejects implausible overtake candidates with large gaps even in tier3', () => {
    const question = getQuestionById('OVR_PASS_NEXT_3')!;
    const candidate = {
      question,
      driver1: createDriver({ interval: 8.0 }),
      driver2: createDriver({ driverNumber: 44, position: 1, interval: null }),
      score: 50,
    };

    expect(isPlausibleCandidate(candidate, 'tier3')).toBe(false);
  });

  it('rejects pit-window questions for drivers on very fresh tyres', () => {
    const question = getQuestionById('PIT_STOP_NEXT_3')!;
    const candidate = {
      question,
      driver1: createDriver({ tyreAge: 4, pitCount: 1 }),
      driver2: createDriver({ driverNumber: 44, position: 1, interval: null }),
      score: 50,
    };

    expect(isPlausibleCandidate(candidate, 'urgency')).toBe(false);
  });

  it('allows questions one lap after resolution when urgency is active', () => {
    const snapshot = createSnapshot({ lapNumber: 40, totalLaps: 50 });
    const pacing = getPacingState(snapshot, 4, lobbyId);
    expect(pacing.urgency).toBe(true);
    expect(pacing.postResolutionCooldown).toBe(1);
    expect(getTiersToTry(snapshot, 4)).toContain('urgency');

    recordResolution(lobbyId, 'GAP_CLOSING', 38);

    const previous = createSnapshot({ lapNumber: 39, totalLaps: 50 });
    const result = selectQuestion(snapshot, previous, lobbyId, null, 4);
    expect(result).not.toBeNull();
  });

  it('aims normal races above the bare minimum engagement floor', () => {
    const snapshot = createSnapshot({ lapNumber: 25, totalLaps: 57 });
    const pacing = getPacingState(snapshot, 1, lobbyId);

    expect(getPacingMinimumQuestionCount(snapshot)).toBe(8);
    expect(getPacingTargetQuestionCount(snapshot)).toBe(10);
    expect(pacing.expectedQuestionCount).toBe(4);
    expect(pacing.behindTarget).toBe(true);
  });

  it('uses a lower pacing floor for short sprint-length races', () => {
    const snapshot = createSnapshot({ lapNumber: 12, totalLaps: 23 });
    const pacing = getPacingState(snapshot, 4, lobbyId);

    expect(getPacingMinimumQuestionCount(snapshot)).toBe(6);
    expect(getPacingTargetQuestionCount(snapshot)).toBe(6);
    expect(pacing.questionsRemaining).toBe(2);
  });

  it('selects a quiet-race fallback when a normal replay is behind pace', () => {
    const previous = createSnapshot({
      lapNumber: 24,
      totalLaps: 57,
      drivers: [
        createDriver({ driverNumber: 44, name: 'Leader', position: 1, gap: 0, interval: null, tyreAge: 8 }),
        createDriver({ driverNumber: 81, name: 'Chaser', position: 2, gap: 2.2, interval: 2.2, tyreAge: 8 }),
        createDriver({ driverNumber: 16, name: 'Midfield', position: 3, gap: 5.8, interval: 3.6, tyreAge: 8 }),
      ],
    });
    const snapshot = createSnapshot({
      lapNumber: 25,
      totalLaps: 57,
      drivers: [
        createDriver({ driverNumber: 44, name: 'Leader', position: 1, gap: 0, interval: null, tyreAge: 9 }),
        createDriver({ driverNumber: 81, name: 'Chaser', position: 2, gap: 2.2, interval: 2.2, tyreAge: 9 }),
        createDriver({ driverNumber: 16, name: 'Midfield', position: 3, gap: 5.8, interval: 3.6, tyreAge: 9 }),
      ],
    });

    const result = selectQuestionWithMeta(snapshot, previous, lobbyId, null, 1);
    expect(result.instance).not.toBeNull();
    expect(result.tier).toBe('tier1');
  });

  it('does not force quiet-race fallback when the lobby is on pace', () => {
    const previous = createSnapshot({
      lapNumber: 24,
      totalLaps: 57,
      drivers: [
        createDriver({ driverNumber: 44, name: 'Leader', position: 1, gap: 0, interval: null, tyreAge: 8 }),
        createDriver({ driverNumber: 81, name: 'Chaser', position: 2, gap: 2.2, interval: 2.2, tyreAge: 8 }),
        createDriver({ driverNumber: 16, name: 'Midfield', position: 3, gap: 5.8, interval: 3.6, tyreAge: 8 }),
      ],
    });
    const snapshot = createSnapshot({
      lapNumber: 25,
      totalLaps: 57,
      drivers: [
        createDriver({ driverNumber: 44, name: 'Leader', position: 1, gap: 0, interval: null, tyreAge: 9 }),
        createDriver({ driverNumber: 81, name: 'Chaser', position: 2, gap: 2.2, interval: 2.2, tyreAge: 9 }),
        createDriver({ driverNumber: 16, name: 'Midfield', position: 3, gap: 5.8, interval: 3.6, tyreAge: 9 }),
      ],
    });

    const result = selectQuestionWithMeta(snapshot, previous, lobbyId, null, 4);
    expect(result.instance).toBeNull();
    expect(result.tier).toBeNull();
  });

  it('uses zero-lap cooldown on short races still below the minimum', () => {
    const snapshot = createSnapshot({ lapNumber: 12, totalLaps: 23 });
    const pacing = getPacingState(snapshot, 4, lobbyId);
    expect(pacing.postResolutionCooldown).toBe(0);
  });

  it('does not surface Final Stretch prompts before the final race phase', () => {
    const drivers = [
      createDriver({ driverNumber: 44, name: 'Leader', position: 1, gap: 0, interval: null, tyreAge: 4, pitCount: 3 }),
      createDriver({ driverNumber: 81, name: 'Chaser', position: 2, gap: 9, interval: 9, tyreAge: 4, pitCount: 3 }),
      createDriver({ driverNumber: 16, name: 'Midfield', position: 9, gap: 24, interval: 15, tyreAge: 4, pitCount: 3 }),
    ];
    const previous = createSnapshot({ lapNumber: 31, totalLaps: 57, drivers });
    const snapshot = createSnapshot({ lapNumber: 32, totalLaps: 57, drivers });

    const result = selectQuestionWithMeta(snapshot, previous, lobbyId, null, 1);
    expect(result.instance).toBeNull();
  });

  it('allows Final Stretch prompts in the last 15 percent of the race', () => {
    const drivers = [
      createDriver({ driverNumber: 44, name: 'Leader', position: 1, gap: 0, interval: null, tyreAge: 4, pitCount: 3 }),
      createDriver({ driverNumber: 81, name: 'Chaser', position: 2, gap: 9, interval: 9, tyreAge: 4, pitCount: 3 }),
      createDriver({ driverNumber: 16, name: 'Midfield', position: 9, gap: 24, interval: 15, tyreAge: 4, pitCount: 3 }),
    ];
    const previous = createSnapshot({ lapNumber: 49, totalLaps: 57, drivers });
    const snapshot = createSnapshot({ lapNumber: 50, totalLaps: 57, drivers });

    const result = selectQuestionWithMeta(snapshot, previous, lobbyId, null, 7);
    expect(result.instance?.questionId.startsWith('FIN_')).toBe(true);
  });

  it('prefers strict tier when strict candidates exist below minimum count', () => {
    const previous = createSnapshot({ lapNumber: 9 });
    const snapshot = createSnapshot({ lapNumber: 10 });

    const result = selectQuestionWithMeta(snapshot, previous, lobbyId, null, 3);
    expect(result.instance).not.toBeNull();
    expect(result.tier).toBe('strict');
  });

  it('can reach the pacing target across a short sprint simulation', () => {
    const totalLaps = 23;
    let questionCount = 0;
    let activeQuestion: QuestionInstanceState | null = null;

    for (let lap = 1; lap <= totalLaps; lap++) {
      const phase = lap % 4;
      const chaserInterval = phase === 0 ? 1.2 : phase === 1 ? 1.6 : phase === 2 ? 2.0 : 2.4;
      const prevChaserInterval = chaserInterval + 0.12;
      const rotatingTyreAge = 15 + (lap % 3);

      const currentDrivers = [
        createDriver({ driverNumber: 44, name: 'Leader', position: 1, gap: 0, interval: null, tyreAge: 10 }),
        createDriver({
          driverNumber: 81,
          name: 'Chaser',
          position: 2,
          gap: chaserInterval + 1,
          interval: chaserInterval,
          tyreAge: rotatingTyreAge,
          lastLapTime: 91.2,
        }),
        createDriver({
          driverNumber: 16,
          name: 'Midfield',
          position: lap >= 12 ? 9 : 7,
          gap: 18 + lap,
          interval: phase <= 1 ? 1.4 : 2.8,
          tyreAge: rotatingTyreAge + 1,
          lastLapTime: 92.0,
        }),
        createDriver({
          driverNumber: 55,
          name: 'Backmarker',
          position: 14,
          gap: 40 + lap,
          interval: 2.2,
          tyreAge: rotatingTyreAge,
          lastLapTime: 93.0,
        }),
      ];

      const previousDrivers = currentDrivers.map((driver) => {
        if (driver.driverNumber === 81) {
          return { ...driver, interval: prevChaserInterval };
        }
        if (driver.driverNumber === 16 && phase <= 1) {
          return { ...driver, interval: (driver.interval ?? 2) + 0.1 };
        }
        return driver;
      });

      const snapshot = createSnapshot({ lapNumber: lap, totalLaps, drivers: currentDrivers });
      const previous = lap > 1
        ? createSnapshot({ lapNumber: lap - 1, totalLaps, drivers: previousDrivers })
        : null;

      if (activeQuestion && lap >= activeQuestion.targetLap) {
        const question = getQuestionById(activeQuestion.questionId);
        if (question) {
          recordResolution(lobbyId, question.category, lap);
        }
        activeQuestion = null;
      }

      const selected = selectQuestion(snapshot, previous, lobbyId, activeQuestion, questionCount);
      if (selected) {
        activeQuestion = selected;
        questionCount += 1;
      }
    }

    const raceEnd = createSnapshot({ lapNumber: totalLaps, totalLaps });
    expect(questionCount).toBeGreaterThanOrEqual(getPacingTargetQuestionCount(raceEnd));
    expect(questionCount).toBeLessThanOrEqual(MAX_QUESTIONS_PER_RACE);
  });

  it('can reach 8 questions across a quiet normal-race simulation', () => {
    const totalLaps = 57;
    let questionCount = 0;
    let activeQuestion: QuestionInstanceState | null = null;

    for (let lap = 1; lap <= totalLaps; lap++) {
      const tyreAge = Math.max(1, lap - 1);
      const currentDrivers = [
        createDriver({ driverNumber: 44, name: 'Leader', position: 1, gap: 0, interval: null, tyreAge: Math.max(1, tyreAge - 3) }),
        createDriver({ driverNumber: 81, name: 'Chaser', position: 2, gap: 2.2, interval: 2.2, tyreAge }),
        createDriver({ driverNumber: 16, name: 'Midfield', position: 3, gap: 5.8, interval: 3.6, tyreAge: tyreAge + 1 }),
        createDriver({ driverNumber: 55, name: 'Points Runner', position: 9, gap: 22.0, interval: 2.4, tyreAge }),
      ];
      const previousDrivers = currentDrivers.map((driver) => ({ ...driver }));
      const snapshot = createSnapshot({ lapNumber: lap, totalLaps, drivers: currentDrivers });
      const previous = lap > 1
        ? createSnapshot({ lapNumber: lap - 1, totalLaps, drivers: previousDrivers })
        : null;

      if (activeQuestion && lap >= activeQuestion.targetLap) {
        const question = getQuestionById(activeQuestion.questionId);
        if (question) {
          recordResolution(lobbyId, question.category, lap);
        }
        activeQuestion = null;
      }

      const selected = selectQuestion(snapshot, previous, lobbyId, activeQuestion, questionCount);
      if (selected) {
        activeQuestion = selected;
        questionCount += 1;
      }
    }

    expect(questionCount).toBeGreaterThanOrEqual(8);
    expect(questionCount).toBeLessThanOrEqual(MAX_QUESTIONS_PER_RACE);
  });
});
