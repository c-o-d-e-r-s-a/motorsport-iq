import type { RaceSnapshot, DriverState, Question, QuestionInstanceState, DerivedSignals, QuestionCategory } from '../types';
import { QUESTION_BANK } from './questionBank';
import { calculateDerivedSignals, type SignalOverrides } from './derivedSignals';
import { randomUUID } from 'crypto';

export const MIN_QUESTIONS_PER_RACE = 8;
export const MAX_QUESTIONS_PER_RACE = 15;

const LAPS_PER_QUESTION_CYCLE = 4;
const SHORT_RACE_MAX_LAPS = 25;
const SHORT_RACE_MIN_QUESTIONS = 5;
const SHORT_RACE_LAPS_PER_TARGET_QUESTION = 4;
const LAPS_PER_TARGET_QUESTION = 6;
const TIER1_PROGRESS_THRESHOLD = 0.25;
const TIER2_PROGRESS_THRESHOLD = 0.4;
const TIER3_PROGRESS_THRESHOLD = 0.55;
const FINAL_STRETCH_PROGRESS_THRESHOLD = 0.85;

export type RelaxationTier = 'strict' | 'tier1' | 'tier2' | 'tier3' | 'urgency';

export interface PacingState {
  tier: RelaxationTier;
  behindMin: boolean;
  behindTarget: boolean;
  urgency: boolean;
  postResolutionCooldown: 0 | 1 | 2;
  questionsRemaining: number;
  eligibleLapsRemaining: number;
  minimumQuestions: number;
  targetQuestions: number;
  expectedQuestionCount: number;
}

/**
 * Per-tier signal relaxation. Urgency reuses tier3 thresholds (cooldown only differs).
 */
export const TIER_SIGNAL_OVERRIDES: Record<RelaxationTier, SignalOverrides> = {
  strict: {
    closingTrendThreshold: 0.1,
    closeBattleThreshold: 4.0,
    // Mirrors the raised default — Final Stretch only in the last ~15% of the race.
    lateRacePhasePercent: FINAL_STRETCH_PROGRESS_THRESHOLD,
    overtakeOpportunityMaxGap: 1.5,
  },
  tier1: {
    closingTrendThreshold: 0.05,
    closeBattleThreshold: 4.0,
    lateRacePhasePercent: FINAL_STRETCH_PROGRESS_THRESHOLD,
    overtakeOpportunityMaxGap: 2.0,
  },
  tier2: {
    closingTrendThreshold: 0.05,
    closeBattleThreshold: 5.0,
    lateRacePhasePercent: FINAL_STRETCH_PROGRESS_THRESHOLD,
    overtakeOpportunityMaxGap: 2.5,
  },
  tier3: {
    closingTrendThreshold: 0.05,
    closeBattleThreshold: 5.0,
    lateRacePhasePercent: FINAL_STRETCH_PROGRESS_THRESHOLD,
    overtakeOpportunityMaxGap: 3.0,
  },
  urgency: {
    closingTrendThreshold: 0.05,
    closeBattleThreshold: 5.0,
    lateRacePhasePercent: FINAL_STRETCH_PROGRESS_THRESHOLD,
    overtakeOpportunityMaxGap: 3.0,
  },
};

/** Extra relaxation for ~20-lap sprints still below the minimum question count. */
const SPRINT_CATCHUP_OVERRIDES: SignalOverrides = {
  closingTrendThreshold: 0.02,
  closeBattleThreshold: 7.5,
  lateRacePhasePercent: FINAL_STRETCH_PROGRESS_THRESHOLD,
  overtakeOpportunityMaxGap: 5.5,
  pitWindowStintLength: 12,
};

export interface TriggerContext {
  snapshot: RaceSnapshot;
  previousSnapshot: RaceSnapshot | null;
  signals: DerivedSignals;
  tier: RelaxationTier;
  shortRaceCatchup?: boolean;
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

export interface QuestionSelectionResult {
  instance: QuestionInstanceState | null;
  tier: RelaxationTier | null;
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

function getRaceProgress(snapshot: RaceSnapshot): number {
  if (!snapshot.totalLaps || snapshot.totalLaps <= 0) {
    return 0;
  }

  return snapshot.lapNumber / snapshot.totalLaps;
}

function isShortRace(snapshot: RaceSnapshot): boolean {
  return snapshot.totalLaps !== null && snapshot.totalLaps <= SHORT_RACE_MAX_LAPS;
}

export function getPacingMinimumQuestionCount(snapshot: RaceSnapshot): number {
  const totalLaps = snapshot.totalLaps;
  if (!totalLaps || totalLaps <= 0) {
    return MIN_QUESTIONS_PER_RACE;
  }

  if (!isShortRace(snapshot)) {
    return MIN_QUESTIONS_PER_RACE;
  }

  return Math.min(
    MIN_QUESTIONS_PER_RACE,
    Math.max(SHORT_RACE_MIN_QUESTIONS, Math.ceil(totalLaps / SHORT_RACE_LAPS_PER_TARGET_QUESTION))
  );
}

export function getPacingTargetQuestionCount(snapshot: RaceSnapshot): number {
  const totalLaps = snapshot.totalLaps;
  const minimumQuestions = getPacingMinimumQuestionCount(snapshot);
  if (!totalLaps || totalLaps <= 0 || isShortRace(snapshot)) {
    return minimumQuestions;
  }

  return Math.min(
    MAX_QUESTIONS_PER_RACE,
    Math.max(minimumQuestions, Math.ceil(totalLaps / LAPS_PER_TARGET_QUESTION))
  );
}

function isTier1Active(snapshot: RaceSnapshot, questionCount: number, behindTarget: boolean): boolean {
  const progress = getRaceProgress(snapshot);
  return (behindTarget && progress >= TIER1_PROGRESS_THRESHOLD)
    || (isShortRace(snapshot) && snapshot.lapNumber >= 4 && questionCount === 0);
}

function isTier2Active(snapshot: RaceSnapshot, questionCount: number, behindTarget: boolean): boolean {
  const progress = getRaceProgress(snapshot);
  return (behindTarget && progress >= TIER2_PROGRESS_THRESHOLD)
    || (questionCount < 6 && progress >= 0.5);
}

function isTier3Active(snapshot: RaceSnapshot, questionCount: number, behindTarget: boolean): boolean {
  const progress = getRaceProgress(snapshot);
  return (behindTarget && progress >= TIER3_PROGRESS_THRESHOLD)
    || (questionCount < 7 && progress >= 0.65);
}

function isShortRaceBehindMin(snapshot: RaceSnapshot, questionCount: number): boolean {
  return isShortRace(snapshot)
    && snapshot.lapNumber >= 4
    && questionCount < getPacingMinimumQuestionCount(snapshot);
}

export function getPacingState(
  snapshot: RaceSnapshot,
  questionCount: number,
  _lobbyId?: string
): PacingState {
  const totalLaps = snapshot.totalLaps;
  const raceProgress = getRaceProgress(snapshot);
  const minimumQuestions = getPacingMinimumQuestionCount(snapshot);
  const targetQuestions = getPacingTargetQuestionCount(snapshot);
  const expectedMinimumCount = totalLaps ? Math.floor(minimumQuestions * raceProgress) : 0;
  const expectedQuestionCount = totalLaps ? Math.floor(targetQuestions * raceProgress) : 0;
  const behindMin = totalLaps ? questionCount < expectedMinimumCount : false;
  const behindTarget = totalLaps ? questionCount < expectedQuestionCount : false;
  const questionsRemaining = Math.max(0, minimumQuestions - questionCount);
  const eligibleLapsRemaining = totalLaps
    ? Math.max(0, totalLaps - snapshot.lapNumber - 1)
    : 0;
  const cycleLaps = isShortRace(snapshot) ? 3 : LAPS_PER_QUESTION_CYCLE;
  const estimatedSlotsRemaining = Math.floor(eligibleLapsRemaining / cycleLaps);
  const urgency = questionCount < minimumQuestions
    && (questionsRemaining > estimatedSlotsRemaining || isShortRaceBehindMin(snapshot, questionCount));

  let tier: RelaxationTier = 'strict';
  if (urgency) {
    tier = 'urgency';
  } else if (isTier3Active(snapshot, questionCount, behindTarget)) {
    tier = 'tier3';
  } else if (isTier2Active(snapshot, questionCount, behindTarget)) {
    tier = 'tier2';
  } else if (isTier1Active(snapshot, questionCount, behindTarget)) {
    tier = 'tier1';
  }

  const needsShortRaceCatchUp = isShortRaceBehindMin(snapshot, questionCount);

  return {
    tier,
    behindMin,
    behindTarget,
    urgency,
    postResolutionCooldown: needsShortRaceCatchUp ? 0 : urgency ? 1 : 2,
    questionsRemaining,
    eligibleLapsRemaining,
    minimumQuestions,
    targetQuestions,
    expectedQuestionCount,
  };
}

export function getTiersToTry(snapshot: RaceSnapshot, questionCount: number): RelaxationTier[] {
  const minimumQuestions = getPacingMinimumQuestionCount(snapshot);
  if (questionCount >= minimumQuestions) {
    return ['strict'];
  }

  const pacing = getPacingState(snapshot, questionCount);
  if (pacing.urgency) {
    return ['strict', 'tier1', 'tier2', 'tier3', 'urgency'];
  }

  if (isShortRace(snapshot) && snapshot.lapNumber >= 4 && questionCount < minimumQuestions) {
    return ['strict', 'tier1', 'tier2', 'tier3'];
  }

  const tiers: RelaxationTier[] = ['strict'];

  if (isTier1Active(snapshot, questionCount, pacing.behindTarget)) {
    tiers.push('tier1');
  }
  if (isTier2Active(snapshot, questionCount, pacing.behindTarget)) {
    tiers.push('tier2');
  }
  if (isTier3Active(snapshot, questionCount, pacing.behindTarget)) {
    tiers.push('tier3');
  }

  return tiers;
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
  maxQuestions = MAX_QUESTIONS_PER_RACE,
  postResolutionCooldown: 0 | 1 | 2 = 2
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

  if (state.lastResolvedLap !== null && snapshot.lapNumber - state.lastResolvedLap < postResolutionCooldown) {
    return { eligible: false, reason: 'Post-resolution cooldown active' };
  }

  if (snapshot.totalLaps && snapshot.lapNumber >= snapshot.totalLaps) {
    return { eligible: false, reason: 'Race complete' };
  }

  return { eligible: true };
}

function relaxTriggersForTier(question: Question, tier: RelaxationTier): Question['triggers'] {
  if ((tier !== 'tier2' && tier !== 'tier3' && tier !== 'urgency') || question.category !== 'FINISH_POSITION') {
    return question.triggers;
  }

  return question.triggers.map((trigger) => {
    if (trigger.type !== 'positionRange') {
      return trigger;
    }

    const min = Number(trigger.params.min ?? 1);
    const max = Number(trigger.params.max ?? 20);
    if (min >= 4 && max <= 12) {
      return {
        ...trigger,
        params: { ...trigger.params, min: 6, max: 15 },
      };
    }

    return trigger;
  });
}

export function evaluateTrigger(
  trigger: { type: string; params: Record<string, unknown> },
  context: TriggerContext,
  driver1: DriverState,
  driver2: DriverState | null
): boolean {
  const { signals } = context;

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

    case 'overtakeModeArmed':
      return signals.overtakeModeArmed.get(driver1.driverNumber) ?? false;

    case 'undercutPressure':
      return signals.undercutPressure.get(driver1.driverNumber) ?? false;

    case 'positionRange': {
      const min = Number(trigger.params.min ?? 1);
      const max = Number(trigger.params.max ?? 20);
      return driver1.position >= min && driver1.position <= max;
    }

    case 'gapRange': {
      const gap = driver1.interval;
      if (gap === null) return false;

      const minGap = Number(trigger.params.minGap ?? 0);
      let maxGap = Number(trigger.params.maxGap ?? Number.POSITIVE_INFINITY);
      if (context.shortRaceCatchup) {
        maxGap = Math.max(maxGap, 6.0);
      }
      return gap >= minGap && gap <= maxGap;
    }

    case 'positionClose': {
      if (!driver2) return false;
      let maxGap = Number(trigger.params.maxGap ?? 5.0);
      if (context.shortRaceCatchup) {
        maxGap = Math.max(maxGap, 8.0);
      }
      const gap = Math.abs((driver1.gap ?? 0) - (driver2.gap ?? 0));
      return gap <= maxGap;
    }

    default:
      return false;
  }
}

export function isPlausibleCandidate(candidate: QuestionCandidate, tier: RelaxationTier): boolean {
  const { question, driver1, driver2 } = candidate;

  if (driver1.retired || driver1.inPit) {
    return false;
  }

  if (question.category === 'OVERTAKE' && (driver1.interval ?? Infinity) > 5.0) {
    return false;
  }

  if (question.category === 'GAP_CLOSING' && (driver1.interval ?? Infinity) > 6.0) {
    return false;
  }

  if (
    question.category === 'FINISH_POSITION'
    && question.successCondition.type === 'maintainPosition'
    && driver1.position === 1
    && (driver2?.interval ?? Infinity) > 10
  ) {
    return false;
  }

  void tier;
  return true;
}

export function evaluateAllTriggers(
  question: Question,
  context: TriggerContext,
  tier: RelaxationTier = context.tier
): QuestionCandidate[] {
  const candidates: QuestionCandidate[] = [];
  const { snapshot } = context;

  // Don't trigger a question if there aren't enough laps remaining for it to
  // resolve before the race ends. Prevents e.g. a 3-lap question from
  // triggering on the penultimate lap and never being resolved.
  if (
    snapshot.totalLaps
    && snapshot.lapNumber + question.windowSize > snapshot.totalLaps
  ) {
    return candidates;
  }

  const drivers = snapshot.drivers.filter((driver) => !driver.retired && !driver.inPit);
  const triggers = relaxTriggersForTier(question, tier);

  for (const driver1 of drivers) {
    const driver2 = getDriverAhead(snapshot, driver1);
    const allTriggersPass = triggers.every((trigger) => evaluateTrigger(trigger, context, driver1, driver2));

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

function pickQuestionCandidate(candidates: QuestionCandidate[], tier: RelaxationTier): QuestionCandidate {
  const useRelaxedPriority = tier === 'tier2' || tier === 'tier3' || tier === 'urgency';
  const sorted = useRelaxedPriority
    ? [...candidates].sort((a, b) => b.score - a.score)
    : applyPriorityHierarchy(candidates);

  const topScore = sorted[0].score;
  let contenders = sorted.filter((candidate) => candidate.score >= topScore - 15);

  if (useRelaxedPriority) {
    const lowerPriority = contenders.filter((candidate) => candidate.question.priority >= 3);
    if (lowerPriority.length > 0) {
      contenders = lowerPriority;
    }
  } else {
    const bestPriority = sorted[0].question.priority;
    contenders = contenders.filter((candidate) => candidate.question.priority === bestPriority);
  }

  if (useRelaxedPriority) {
    const shortWindow = contenders.filter((candidate) => candidate.question.windowSize === 2);
    if (shortWindow.length > 0) {
      contenders = shortWindow;
    }
  }

  return contenders[Math.floor(Math.random() * contenders.length)];
}

function resolveTierOverrides(
  snapshot: RaceSnapshot,
  questionCount: number,
  tier: RelaxationTier
): SignalOverrides {
  const base = { ...TIER_SIGNAL_OVERRIDES[tier] };
  if (isShortRace(snapshot) && questionCount < getPacingMinimumQuestionCount(snapshot) && tier !== 'strict') {
    return { ...base, ...SPRINT_CATCHUP_OVERRIDES };
  }

  if (isShortRace(snapshot) && questionCount < 4 && tier === 'tier1') {
    return { ...base, ...SPRINT_CATCHUP_OVERRIDES };
  }

  return base;
}

function shouldUseEngagementFallback(
  snapshot: RaceSnapshot,
  questionCount: number,
  tier: RelaxationTier
): boolean {
  if (tier === 'strict' || questionCount >= getPacingMinimumQuestionCount(snapshot)) {
    return false;
  }

  const pacing = getPacingState(snapshot, questionCount);
  if (!pacing.behindTarget && !pacing.urgency && !isShortRaceBehindMin(snapshot, questionCount)) {
    return false;
  }

  // Tier 1 only adds conservative state-based prompts. Wider fallback
  // categories wait until the race is clearly behind the engagement pace.
  if (tier === 'tier1') {
    return questionCount === 0 || getRaceProgress(snapshot) >= 0.3 || isShortRace(snapshot);
  }

  return true;
}

function findQuestion(questionId: string): Question | null {
  return QUESTION_BANK.find((question) => question.id === questionId) ?? null;
}

function getGapToCarAhead(driver1: DriverState, driver2: DriverState | null): number | null {
  if (driver1.interval !== null) {
    return driver1.interval;
  }

  if (driver1.gap !== null && driver2 && driver2.gap !== null) {
    return Math.abs(driver1.gap - driver2.gap);
  }

  return null;
}

function getDriverForGapQuestion(driver: DriverState, gapToAhead: number | null): DriverState {
  if (driver.interval !== null || gapToAhead === null) {
    return driver;
  }

  return { ...driver, interval: gapToAhead };
}

function getFallbackPitTyreAgeThreshold(tier: RelaxationTier): number {
  switch (tier) {
    case 'tier1':
      return 15;
    case 'tier2':
      return 13;
    default:
      return 11;
  }
}

function pushFallbackCandidate(
  candidates: QuestionCandidate[],
  questionId: string,
  context: TriggerContext,
  lastCategory: QuestionCategory | null,
  driver1: DriverState,
  driver2: DriverState | null,
  scoreBoost = 0
): void {
  const question = findQuestion(questionId);
  if (!question || question.category === lastCategory) {
    return;
  }

  const candidate: QuestionCandidate = {
    question,
    driver1,
    driver2,
    score: calculateQuestionScore(question, driver1, driver2, context) + scoreBoost,
  };

  if (isPlausibleCandidate(candidate, context.tier)) {
    candidates.push(candidate);
  }
}

function buildEngagementFallbackCandidates(
  context: TriggerContext,
  lastCategory: QuestionCategory | null
): QuestionCandidate[] {
  const { snapshot, tier } = context;
  const candidates: QuestionCandidate[] = [];
  const progress = getRaceProgress(snapshot);
  const pitTyreAgeThreshold = getFallbackPitTyreAgeThreshold(tier);
  const allowWiderGapPrompts = tier === 'tier2' || tier === 'tier3' || tier === 'urgency';
  const allowPositionPrompts = (tier === 'tier3' || tier === 'urgency')
    && progress >= FINAL_STRETCH_PROGRESS_THRESHOLD;

  for (const driver of snapshot.drivers) {
    if (driver.retired || driver.inPit || driver.position <= 0) {
      continue;
    }

    const driverAhead = getDriverAhead(snapshot, driver);
    const gapToAhead = getGapToCarAhead(driver, driverAhead);
    const gapDriver = getDriverForGapQuestion(driver, gapToAhead);

    if (driverAhead && gapToAhead !== null) {
      if (driver.interval !== null && gapToAhead <= 1.2) {
        pushFallbackCandidate(
          candidates,
          'GAP_STAY_CLOSE',
          context,
          lastCategory,
          driver,
          driverAhead,
          14
        );
      }

      if (gapToAhead > 1.0 && gapToAhead <= 2.5) {
        pushFallbackCandidate(
          candidates,
          'OVR_CLOSE_TO_1S',
          context,
          lastCategory,
          gapDriver,
          driverAhead,
          10
        );
      }

      if (allowWiderGapPrompts && gapToAhead >= 1.4 && gapToAhead <= 5.5) {
        pushFallbackCandidate(
          candidates,
          'GAP_REDUCE_1S',
          context,
          lastCategory,
          gapDriver,
          driverAhead,
          8
        );
      }

      if (
        tier === 'urgency'
        && driver.position >= 4
        && driver.position <= 15
        && gapToAhead <= 5.0
      ) {
        pushFallbackCandidate(
          candidates,
          'OVR_GAIN_POSITION',
          context,
          lastCategory,
          gapDriver,
          driverAhead,
          4
        );
      }
    }

    if (driver.tyreAge >= pitTyreAgeThreshold && driver.pitCount < 3) {
      pushFallbackCandidate(
        candidates,
        'PIT_STOP_NEXT_3',
        context,
        lastCategory,
        driver,
        driverAhead,
        6
      );

      if (allowWiderGapPrompts && driver.tyreAge >= pitTyreAgeThreshold + 1) {
        pushFallbackCandidate(
          candidates,
          'PIT_STAY_OUT_NEXT_3',
          context,
          lastCategory,
          driver,
          driverAhead,
          4
        );
      }
    }

    if (allowPositionPrompts) {
      if (driver.position <= 5) {
        pushFallbackCandidate(
          candidates,
          'FIN_TOP_5',
          context,
          lastCategory,
          driver,
          driverAhead,
          4
        );
      }

      if (driver.position >= 8 && driver.position <= 12) {
        pushFallbackCandidate(
          candidates,
          'FIN_POINTS_HOLD',
          context,
          lastCategory,
          driver,
          driverAhead,
          4
        );
      }

      if (driver.position >= 2 && driver.position <= 3) {
        pushFallbackCandidate(
          candidates,
          'FIN_PODIUM_HOLD',
          context,
          lastCategory,
          driver,
          driverAhead,
          2
        );
      }
    }
  }

  return candidates;
}

function gatherCandidates(
  snapshot: RaceSnapshot,
  previousSnapshot: RaceSnapshot | null,
  lastCategory: QuestionCategory | null,
  tier: RelaxationTier,
  questionCount: number
): QuestionCandidate[] {
  const shortRaceCatchup = isShortRace(snapshot)
    && questionCount < getPacingMinimumQuestionCount(snapshot)
    && tier !== 'strict';
  const signals = calculateDerivedSignals(
    snapshot,
    previousSnapshot,
    resolveTierOverrides(snapshot, questionCount, tier)
  );
  const context: TriggerContext = { snapshot, previousSnapshot, signals, tier, shortRaceCatchup };
  let allCandidates: QuestionCandidate[] = [];

  for (const question of QUESTION_BANK) {
    if (lastCategory === question.category) {
      continue;
    }

    allCandidates = allCandidates.concat(evaluateAllTriggers(question, context, tier));
  }

  const plausibleCandidates = allCandidates.filter((candidate) => isPlausibleCandidate(candidate, tier));
  if (plausibleCandidates.length > 0) {
    return plausibleCandidates;
  }

  if (!shouldUseEngagementFallback(snapshot, questionCount, tier)) {
    return plausibleCandidates;
  }

  return buildEngagementFallbackCandidates(context, lastCategory);
}

function buildQuestionInstance(
  selected: QuestionCandidate,
  snapshot: RaceSnapshot,
  lobbyId: string
): QuestionInstanceState {
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

export function selectQuestionWithMeta(
  snapshot: RaceSnapshot,
  previousSnapshot: RaceSnapshot | null,
  lobbyId: string,
  activeQuestion: QuestionInstanceState | null,
  questionCount: number
): QuestionSelectionResult {
  updateRestartCooldown(lobbyId, snapshot, previousSnapshot);

  const pacingState = getPacingState(snapshot, questionCount, lobbyId);
  const eligibility = checkGlobalEligibility(
    snapshot,
    activeQuestion,
    questionCount,
    lobbyId,
    MAX_QUESTIONS_PER_RACE,
    pacingState.postResolutionCooldown
  );

  if (!eligibility.eligible) {
    return { instance: null, tier: null };
  }

  const state = getLobbyGuardState(lobbyId);
  const tiersToTry = getTiersToTry(snapshot, questionCount);

  for (const tier of tiersToTry) {
    const candidates = gatherCandidates(snapshot, previousSnapshot, state.lastCategory, tier, questionCount);
    if (candidates.length === 0) {
      continue;
    }

    const selected = pickQuestionCandidate(candidates, tier);
    return {
      instance: buildQuestionInstance(selected, snapshot, lobbyId),
      tier,
    };
  }

  return { instance: null, tier: null };
}

export function selectQuestion(
  snapshot: RaceSnapshot,
  previousSnapshot: RaceSnapshot | null,
  lobbyId: string,
  activeQuestion: QuestionInstanceState | null,
  questionCount: number
): QuestionInstanceState | null {
  return selectQuestionWithMeta(snapshot, previousSnapshot, lobbyId, activeQuestion, questionCount).instance;
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
  const context: TriggerContext = { snapshot, previousSnapshot, signals, tier: 'strict' };
  let candidates: QuestionCandidate[] = [];

  for (const question of QUESTION_BANK) {
    candidates = candidates.concat(evaluateAllTriggers(question, context));
  }

  return applyPriorityHierarchy(candidates.filter((candidate) => isPlausibleCandidate(candidate, 'strict')));
}
