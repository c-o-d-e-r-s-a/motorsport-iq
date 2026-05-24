import type { RaceSnapshot, DriverState, Question, QuestionInstanceState, DerivedSignals, QuestionCategory } from '../types';
import { QUESTION_BANK } from './questionBank';
import { calculateDerivedSignals } from './derivedSignals';
import { randomUUID } from 'crypto';

export interface TriggerContext {
  snapshot: RaceSnapshot;
  previousSnapshot: RaceSnapshot | null;
  signals: DerivedSignals;
}

export interface QuestionCandidate {
  question: Question;
  driver1: DriverState;
  driver2: DriverState | null;
  score: number;
}

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
}

type LobbyGuardState = {
  lastCategory: QuestionCategory | null;
  lastResolvedLap: number | null;
  restartCooldownUntilLap: number | null;
};

const lobbyGuardStates = new Map<string, LobbyGuardState>();

function getLobbyGuardState(lobbyId: string): LobbyGuardState {
  const existing = lobbyGuardStates.get(lobbyId);
  if (existing) {
    return existing;
  }

  const created: LobbyGuardState = {
    lastCategory: null,
    lastResolvedLap: null,
    restartCooldownUntilLap: null,
  };
  lobbyGuardStates.set(lobbyId, created);
  return created;
}

function getDriverAhead(snapshot: RaceSnapshot, driver1: DriverState): DriverState | null {
  if (driver1.position <= 1) {
    return null;
  }

  return snapshot.drivers.find((driver) => driver.position === driver1.position - 1) ?? null;
}

export function updateRestartCooldown(lobbyId: string, snapshot: RaceSnapshot, previousSnapshot: RaceSnapshot | null): void {
  const state = getLobbyGuardState(lobbyId);
  if (!previousSnapshot) {
    return;
  }

  if (previousSnapshot.trackStatus !== 'GREEN' && snapshot.trackStatus === 'GREEN') {
    state.restartCooldownUntilLap = snapshot.lapNumber + 1;
  }
}

export function recordResolution(lobbyId: string, category: QuestionCategory, lapNumber: number): void {
  const state = getLobbyGuardState(lobbyId);
  state.lastCategory = category;
  state.lastResolvedLap = lapNumber;
}

export function checkGlobalEligibility(
  snapshot: RaceSnapshot,
  activeQuestion: QuestionInstanceState | null,
  questionCount: number,
  lobbyId: string,
  maxQuestions = 10
): EligibilityResult {
  const state = getLobbyGuardState(lobbyId);

  if (activeQuestion && !['CLOSED', 'CANCELLED'].includes(activeQuestion.state)) {
    return { eligible: false, reason: 'Active question already exists' };
  }

  if (snapshot.trackStatus !== 'GREEN') {
    return { eligible: false, reason: `Track status is ${snapshot.trackStatus}` };
  }

  if (snapshot.dataFeedStalled) {
    return { eligible: false, reason: 'Data feed stalled' };
  }

  if (snapshot.lapNumber < 4) {
    return { eligible: false, reason: 'MVP blocks questions on laps 1-3' };
  }

  if (questionCount >= maxQuestions) {
    return { eligible: false, reason: 'Maximum questions reached' };
  }

  if (state.restartCooldownUntilLap !== null && snapshot.lapNumber <= state.restartCooldownUntilLap) {
    return { eligible: false, reason: 'Restart cooldown active' };
  }

  if (state.lastResolvedLap !== null && snapshot.lapNumber - state.lastResolvedLap < 2) {
    return { eligible: false, reason: 'Post-resolution cooldown active' };
  }

  if (snapshot.totalLaps && snapshot.lapNumber >= snapshot.totalLaps) {
    return { eligible: false, reason: 'Race complete' };
  }

  return { eligible: true };
}

export function evaluateTrigger(
  trigger: { type: string; params: Record<string, unknown> },
  context: TriggerContext,
  driver1: DriverState,
  driver2: DriverState | null
): boolean {
  const { snapshot, signals } = context;

  switch (trigger.type) {
    case 'overtakeOpportunity':
      return signals.overtakeOpportunity.get(driver1.driverNumber) ?? false;

    case 'closingTrend':
      return signals.closingTrend.get(driver1.driverNumber) ?? false;

    case 'pitWindowOpen':
      return signals.pitWindowOpen.get(driver1.driverNumber) ?? false;

    case 'lateRacePhase':
      return signals.lateRacePhase;

    case 'withinOneSecond':
      return signals.withinOneSecond.get(driver1.driverNumber) ?? false;

    case 'fallingBack':
      return signals.fallingBack.get(driver1.driverNumber) ?? false;

    case 'tyreCliffRisk':
      return signals.tyreCliffRisk.get(driver1.driverNumber) ?? false;

    case 'podiumStabilityTrend':
      return signals.podiumStabilityTrend && driver1.position >= 1 && driver1.position <= 3;

    case 'drsEnabled':
      return driver1.drsEnabled === true;

    case 'positionRange': {
      const min = Number(trigger.params.min ?? 1);
      const max = Number(trigger.params.max ?? 20);
      return driver1.position >= min && driver1.position <= max;
    }

    case 'gapRange': {
      const gap = driver1.interval;
      if (gap === null) return false;

      const minGap = Number(trigger.params.minGap ?? 0);
      const maxGap = Number(trigger.params.maxGap ?? Number.POSITIVE_INFINITY);
      return gap >= minGap && gap <= maxGap;
    }

    case 'positionClose': {
      if (!driver2) return false;
      const maxGap = Number(trigger.params.maxGap ?? 5.0);
      const gap = Math.abs((driver1.gap ?? 0) - (driver2.gap ?? 0));
      return gap <= maxGap;
    }

    default:
      return false;
  }
}

export function evaluateAllTriggers(question: Question, context: TriggerContext): QuestionCandidate[] {
  const candidates: QuestionCandidate[] = [];
  const { snapshot } = context;
  const drivers = snapshot.drivers.filter((driver) => !driver.retired && !driver.inPit);

  for (const driver1 of drivers) {
    const driver2 = getDriverAhead(snapshot, driver1);
    const allTriggersPass = question.triggers.every((trigger) => evaluateTrigger(trigger, context, driver1, driver2));

    if (!allTriggersPass) {
      continue;
    }

    candidates.push({
      question,
      driver1,
      driver2,
      score: calculateQuestionScore(question, driver1, driver2, context),
    });
  }

  return candidates;
}

function calculateQuestionScore(
  question: Question,
  driver1: DriverState,
  driver2: DriverState | null,
  context: TriggerContext
): number {
  let score = 100 - question.priority * 10;

  if (driver1.interval !== null) {
    score += Math.max(0, 25 - driver1.interval * 10);
  }

  if (driver1.position <= 10) {
    score += 10;
  }

  if (driver2 && context.signals.withinOneSecond.get(driver1.driverNumber)) {
    score += 20;
  }

  if (question.category === 'FINISH_POSITION' && context.signals.podiumStabilityTrend) {
    score += 10;
  }

  return score;
}

export function applyPriorityHierarchy(candidates: QuestionCandidate[]): QuestionCandidate[] {
  return candidates.sort((a, b) => {
    if (a.question.priority !== b.question.priority) {
      return a.question.priority - b.question.priority;
    }

    return b.score - a.score;
  });
}

function pickQuestionCandidate(candidates: QuestionCandidate[]): QuestionCandidate {
  const sorted = applyPriorityHierarchy(candidates);
  const bestPriority = sorted[0].question.priority;
  const tier = sorted.filter((candidate) => candidate.question.priority === bestPriority);
  const topScore = tier[0].score;
  const contenders = tier.filter((candidate) => candidate.score >= topScore - 15);

  return contenders[Math.floor(Math.random() * contenders.length)];
}

export function selectQuestion(
  snapshot: RaceSnapshot,
  previousSnapshot: RaceSnapshot | null,
  lobbyId: string,
  activeQuestion: QuestionInstanceState | null,
  questionCount: number
): QuestionInstanceState | null {
  updateRestartCooldown(lobbyId, snapshot, previousSnapshot);

  const eligibility = checkGlobalEligibility(snapshot, activeQuestion, questionCount, lobbyId);
  if (!eligibility.eligible) {
    return null;
  }

  const signals = calculateDerivedSignals(snapshot, previousSnapshot);
  const context: TriggerContext = { snapshot, previousSnapshot, signals };
  const state = getLobbyGuardState(lobbyId);
  let allCandidates: QuestionCandidate[] = [];

  for (const question of QUESTION_BANK) {
    if (state.lastCategory === question.category) {
      continue;
    }

    allCandidates = allCandidates.concat(evaluateAllTriggers(question, context));
  }

  if (allCandidates.length === 0) {
    return null;
  }

  const selected = pickQuestionCandidate(allCandidates);

    return {
    id: randomUUID(),
    lobbyId,
    questionId: selected.question.id,
    state: 'TRIGGERED',
    triggeredAt: new Date(),
    triggerSnapshot: snapshot,
    windowSize: selected.question.windowSize,
    targetLap: snapshot.lapNumber + selected.question.windowSize,
    answer: null,
    outcome: null,
    questionText: formatQuestionText(selected.question, selected.driver1, selected.driver2),
    driver1: selected.driver1,
    driver2: selected.driver2 ?? undefined,
  };
}

export function formatQuestionText(question: Question, driver1: DriverState, driver2: DriverState | null): string {
  return question.template
    .replace(/{driver1}/g, driver1.name)
    .replace(/{driver2}/g, driver2?.name ?? 'the car ahead')
    .replace(/{windowSize}/g, String(question.windowSize))
    .replace(/{position}/g, String(driver1.position))
    .replace(/{tyreAge}/g, String(driver1.tyreAge));
}

export function clearCooldowns(lobbyId: string): void {
  lobbyGuardStates.delete(lobbyId);
}

export function getAllCandidates(snapshot: RaceSnapshot, previousSnapshot: RaceSnapshot | null): QuestionCandidate[] {
  const signals = calculateDerivedSignals(snapshot, previousSnapshot);
  const context: TriggerContext = { snapshot, previousSnapshot, signals };
  let candidates: QuestionCandidate[] = [];

  for (const question of QUESTION_BANK) {
    candidates = candidates.concat(evaluateAllTriggers(question, context));
  }

  return applyPriorityHierarchy(candidates);
}
