import type { Question, QuestionCategory } from '../types';

/**
 * MVP Question Bank
 * Curated questions for observable, lap-based race situations.
 */

export const QUESTION_BANK: Question[] = [
  // ── OVERTAKE ──────────────────────────────────────────────────────────────
  {
    id: 'OVR_PASS_NEXT_3',
    category: 'OVERTAKE',
    difficulty: 'MEDIUM',
    template: 'Will {driver1} overtake {driver2} in the next {windowSize} laps?',
    windowSize: 3,
    triggers: [{ type: 'overtakeOpportunity', params: {} }],
    successCondition: { type: 'overtake', params: {} },
    priority: 1,
    cooldownLaps: 2,
  },
  {
    id: 'OVR_DRS_ATTACK',
    category: 'OVERTAKE',
    difficulty: 'HARD',
    template: 'DRS is open — can {driver1} pass {driver2} in the next 2 laps?',
    windowSize: 2,
    triggers: [
      { type: 'overtakeOpportunity', params: {} },
      { type: 'withinOneSecond', params: {} },
      { type: 'drsEnabled', params: {} },
    ],
    successCondition: { type: 'overtake', params: {} },
    priority: 1,
    cooldownLaps: 2,
  },
  {
    id: 'OVR_MAKE_THE_MOVE',
    category: 'OVERTAKE',
    difficulty: 'MEDIUM',
    template: 'The gap is under a second — will {driver1} complete the move on {driver2} in 2 laps?',
    windowSize: 2,
    triggers: [
      { type: 'overtakeOpportunity', params: {} },
      { type: 'gapRange', params: { minGap: 0.3, maxGap: 1.0 } },
    ],
    successCondition: { type: 'overtake', params: {} },
    priority: 1,
    cooldownLaps: 2,
  },
  {
    id: 'OVR_CLOSE_TO_1S',
    category: 'OVERTAKE',
    difficulty: 'EASY',
    template: 'Will {driver1} close to within 1 second of {driver2} over the next 2 laps?',
    windowSize: 2,
    triggers: [
      { type: 'closingTrend', params: {} },
      { type: 'gapRange', params: { minGap: 1.0, maxGap: 2.5 } },
    ],
    successCondition: { type: 'gapReached', params: { targetGap: 1.0 } },
    priority: 1,
    cooldownLaps: 2,
  },
  {
    id: 'OVR_GAIN_POSITION',
    category: 'OVERTAKE',
    difficulty: 'MEDIUM',
    template: 'Will {driver1} gain at least one position in the next {windowSize} laps?',
    windowSize: 3,
    triggers: [
      { type: 'closingTrend', params: {} },
      { type: 'positionRange', params: { min: 4, max: 15 } },
    ],
    successCondition: { type: 'positionGain', params: { minGain: 1 } },
    priority: 2,
    cooldownLaps: 2,
  },

  // ── PIT WINDOW ────────────────────────────────────────────────────────────
  {
    id: 'PIT_STOP_NEXT_3',
    category: 'PIT_WINDOW',
    difficulty: 'EASY',
    template: 'Will {driver1} pit for fresh tyres in the next {windowSize} laps?',
    windowSize: 3,
    triggers: [{ type: 'pitWindowOpen', params: {} }],
    successCondition: { type: 'pitStop', params: { withinLaps: 3 } },
    priority: 2,
    cooldownLaps: 2,
  },
  {
    id: 'PIT_IMMINENT',
    category: 'PIT_WINDOW',
    difficulty: 'MEDIUM',
    template: 'The pit window is open — will {driver1} box in the next 2 laps?',
    windowSize: 2,
    triggers: [
      { type: 'pitWindowOpen', params: {} },
      { type: 'positionRange', params: { min: 1, max: 10 } },
    ],
    successCondition: { type: 'pitStop', params: { withinLaps: 2 } },
    priority: 2,
    cooldownLaps: 2,
  },
  {
    id: 'PIT_CLIFF_BOX',
    category: 'PIT_WINDOW',
    difficulty: 'MEDIUM',
    template: 'Tyres on lap {tyreAge} — will {driver1} pit before they fall off a cliff?',
    windowSize: 2,
    triggers: [{ type: 'tyreCliffRisk', params: {} }],
    successCondition: { type: 'pitStop', params: { withinLaps: 2 } },
    priority: 2,
    cooldownLaps: 2,
  },
  {
    id: 'PIT_STAY_OUT_NEXT_3',
    category: 'PIT_WINDOW',
    difficulty: 'MEDIUM',
    template: 'Will {driver1} extend this stint and stay out for the next {windowSize} laps?',
    windowSize: 3,
    triggers: [
      { type: 'pitWindowOpen', params: {} },
      { type: 'positionRange', params: { min: 1, max: 15 } },
    ],
    successCondition: { type: 'noPitStop', params: { withinLaps: 3 } },
    priority: 2,
    cooldownLaps: 2,
  },

  // ── GAP CLOSING ───────────────────────────────────────────────────────────
  {
    id: 'GAP_REDUCE_1S',
    category: 'GAP_CLOSING',
    difficulty: 'MEDIUM',
    template: 'Will {driver1} cut at least 1 second off {driver2} in the next {windowSize} laps?',
    windowSize: 3,
    triggers: [
      { type: 'closingTrend', params: {} },
      { type: 'gapRange', params: { minGap: 1.0, maxGap: 4.0 } },
    ],
    successCondition: { type: 'gapReduced', params: { minReduction: 1.0 } },
    priority: 3,
    cooldownLaps: 2,
  },
  {
    id: 'GAP_SLASH_TWO',
    category: 'GAP_CLOSING',
    difficulty: 'HARD',
    template: 'Can {driver1} slash 2 seconds off {driver2} in the next {windowSize} laps?',
    windowSize: 3,
    triggers: [
      { type: 'closingTrend', params: {} },
      { type: 'gapRange', params: { minGap: 2.0, maxGap: 5.0 } },
    ],
    successCondition: { type: 'gapReduced', params: { minReduction: 2.0 } },
    priority: 3,
    cooldownLaps: 2,
  },
  {
    id: 'GAP_FALL_BELOW_1S',
    category: 'GAP_CLOSING',
    difficulty: 'EASY',
    template: 'Will the gap from {driver1} to {driver2} drop below 1 second in 2 laps?',
    windowSize: 2,
    triggers: [
      { type: 'closingTrend', params: {} },
      { type: 'gapRange', params: { minGap: 1.0, maxGap: 2.0 } },
    ],
    successCondition: { type: 'gapReached', params: { targetGap: 1.0 } },
    priority: 3,
    cooldownLaps: 2,
  },
  {
    id: 'GAP_STICKY_DRS',
    category: 'GAP_CLOSING',
    difficulty: 'EASY',
    template: 'Will {driver1} stay glued to {driver2} in DRS range for the next 2 laps?',
    windowSize: 2,
    triggers: [
      { type: 'withinOneSecond', params: {} },
      { type: 'closingTrend', params: {} },
    ],
    successCondition: { type: 'stillWithinGap', params: { targetGap: 1.0 } },
    priority: 3,
    cooldownLaps: 2,
  },
  {
    id: 'GAP_LOSE_DRS',
    category: 'GAP_CLOSING',
    difficulty: 'MEDIUM',
    template: 'Will {driver1} drop out of DRS range behind {driver2} in the next 2 laps?',
    windowSize: 2,
    triggers: [
      { type: 'withinOneSecond', params: {} },
      { type: 'fallingBack', params: {} },
      { type: 'gapRange', params: { minGap: 0.5, maxGap: 1.2 } },
    ],
    successCondition: { type: 'gapExceeded', params: { targetGap: 1.0 } },
    priority: 3,
    cooldownLaps: 2,
  },

  // ── FINISH POSITION ───────────────────────────────────────────────────────
  {
    id: 'FIN_AHEAD_OF_RIVAL',
    category: 'FINISH_POSITION',
    difficulty: 'MEDIUM',
    template: 'Late-race fight — will {driver1} finish ahead of {driver2}?',
    windowSize: 3,
    triggers: [
      { type: 'lateRacePhase', params: {} },
      { type: 'positionClose', params: { maxGap: 5.0 } },
    ],
    successCondition: { type: 'finishAhead', params: {} },
    priority: 4,
    cooldownLaps: 2,
  },
  {
    id: 'FIN_TOP_5',
    category: 'FINISH_POSITION',
    difficulty: 'EASY',
    template: 'Will {driver1} still be in the top 5 after the next {windowSize} laps?',
    windowSize: 3,
    triggers: [
      { type: 'lateRacePhase', params: {} },
      { type: 'positionRange', params: { min: 1, max: 5 } },
    ],
    successCondition: { type: 'finalPosition', params: { maxPosition: 5 } },
    priority: 4,
    cooldownLaps: 2,
  },
  {
    id: 'FIN_PODIUM_PUSH',
    category: 'FINISH_POSITION',
    difficulty: 'HARD',
    template: 'Can {driver1} break onto the podium in the next {windowSize} laps?',
    windowSize: 3,
    triggers: [
      { type: 'lateRacePhase', params: {} },
      { type: 'closingTrend', params: {} },
      { type: 'positionRange', params: { min: 4, max: 6 } },
    ],
    successCondition: { type: 'positionReached', params: { targetPosition: 3 } },
    priority: 4,
    cooldownLaps: 2,
  },
  {
    id: 'FIN_POINTS_HOLD',
    category: 'FINISH_POSITION',
    difficulty: 'EASY',
    template: 'Will {driver1} still be in the points (top 10) after {windowSize} laps?',
    windowSize: 3,
    triggers: [
      { type: 'lateRacePhase', params: {} },
      { type: 'positionRange', params: { min: 8, max: 12 } },
    ],
    successCondition: { type: 'finalPosition', params: { maxPosition: 10 } },
    priority: 4,
    cooldownLaps: 2,
  },
  {
    id: 'FIN_PODIUM_HOLD',
    category: 'FINISH_POSITION',
    difficulty: 'MEDIUM',
    template: 'Will {driver1} hang onto P{position} for the next 2 laps?',
    windowSize: 2,
    triggers: [
      { type: 'lateRacePhase', params: {} },
      { type: 'positionRange', params: { min: 1, max: 3 } },
    ],
    successCondition: { type: 'maintainPosition', params: {} },
    priority: 4,
    cooldownLaps: 2,
  },
  {
    id: 'FIN_PODIUM_STABLE',
    category: 'FINISH_POSITION',
    difficulty: 'MEDIUM',
    template: 'Podium looks settled — will {driver1} still be on the podium in 2 laps?',
    windowSize: 2,
    triggers: [
      { type: 'lateRacePhase', params: {} },
      { type: 'podiumStabilityTrend', params: {} },
      { type: 'positionRange', params: { min: 1, max: 3 } },
    ],
    successCondition: { type: 'maintainPosition', params: {} },
    priority: 4,
    cooldownLaps: 2,
  },
];

export function getQuestionsByCategory(category: QuestionCategory): Question[] {
  return QUESTION_BANK.filter((question) => question.category === category);
}

export function getQuestionById(id: string): Question | undefined {
  return QUESTION_BANK.find((question) => question.id === id);
}

export function getQuestionsSortedByPriority(): Question[] {
  return [...QUESTION_BANK].sort((a, b) => a.priority - b.priority);
}

export function getCategories(): QuestionCategory[] {
  return ['OVERTAKE', 'PIT_WINDOW', 'GAP_CLOSING', 'FINISH_POSITION'];
}

export const CATEGORY_NAMES: Record<QuestionCategory, string> = {
  OVERTAKE: 'Overtake',
  PIT_WINDOW: 'Pit Window',
  GAP_CLOSING: 'Gap Closing',
  FINISH_POSITION: 'Finish Position',
};

export const DIFFICULTY_INFO: Record<string, { name: string; color: string; points: number }> = {
  EASY: { name: 'Easy', color: 'green', points: 10 },
  MEDIUM: { name: 'Medium', color: 'yellow', points: 15 },
  HARD: { name: 'Hard', color: 'red', points: 25 },
};
