import type { Question, QuestionCategory } from '../types';

/**
 * MVP Question Bank
 * Curated questions for observable, lap-based race situations.
 * Copy reflects 2026 regulations: Overtake Mode replaces traditional DRS.
 */

export const QUESTION_BANK: Question[] = [
  // ── OVERTAKE ──────────────────────────────────────────────────────────────
  {
    id: 'OVR_PASS_NEXT_3',
    category: 'OVERTAKE',
    difficulty: 'MEDIUM',
    template: 'Battle brewing — will {driver1} get past {driver2} in the next {windowSize} laps?',
    windowSize: 3,
    triggers: [{ type: 'overtakeOpportunity', params: {} }],
    successCondition: { type: 'overtake', params: {} },
    priority: 1,
    cooldownLaps: 2,
  },
  {
    id: 'OVR_OVERTAKE_MODE',
    category: 'OVERTAKE',
    difficulty: 'HARD',
    template: '{driver1} has Overtake Mode armed — can he pass {driver2} in the next 2 laps?',
    windowSize: 2,
    triggers: [
      { type: 'overtakeOpportunity', params: {} },
      { type: 'overtakeModeArmed', params: {} },
    ],
    successCondition: { type: 'overtake', params: {} },
    priority: 1,
    cooldownLaps: 2,
  },
  {
    id: 'OVR_MAKE_THE_MOVE',
    category: 'OVERTAKE',
    difficulty: 'MEDIUM',
    template: '{driver1} is right on {driver2}\'s tail — will the move stick in the next 2 laps?',
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
    template: '{driver1} is hunting {driver2} down — will he be within 1 second in the next 2 laps?',
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
    template: '{driver1} is on the charge — will he pick up at least one place in the next {windowSize} laps?',
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
    template: 'Fresh rubber calling — will {driver1} pit in the next {windowSize} laps?',
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
    template: 'Strategy window is open — does {driver1} box in the next 2 laps?',
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
    template: 'Tyres at {tyreAge} laps — will {driver1} pit before grip falls off a cliff?',
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
    template: 'Will {driver1} gamble on old tyres and stay out for the next {windowSize} laps?',
    windowSize: 3,
    triggers: [
      { type: 'pitWindowOpen', params: {} },
      { type: 'positionRange', params: { min: 1, max: 15 } },
    ],
    successCondition: { type: 'noPitStop', params: { withinLaps: 3 } },
    priority: 2,
    cooldownLaps: 2,
  },

  {
    id: 'PIT_LEADER_BOX',
    category: 'PIT_WINDOW',
    difficulty: 'HARD',
    template: 'The race leader is on ageing rubber — will {driver1} pit in the next 2 laps?',
    windowSize: 2,
    triggers: [
      { type: 'pitWindowOpen', params: {} },
      { type: 'positionRange', params: { min: 1, max: 1 } },
    ],
    successCondition: { type: 'pitStop', params: { withinLaps: 2 } },
    priority: 2,
    cooldownLaps: 2,
  },
  {
    id: 'PIT_UNDERCUT_GAMBLE',
    category: 'PIT_WINDOW',
    difficulty: 'HARD',
    template: 'Undercut window open — will {driver1} gamble on fresh tyres in the next {windowSize} laps?',
    windowSize: 3,
    triggers: [{ type: 'undercutPressure', params: {} }],
    successCondition: { type: 'pitStop', params: { withinLaps: 3 } },
    priority: 2,
    cooldownLaps: 2,
  },

  // ── GAP CLOSING ───────────────────────────────────────────────────────────
  {
    id: 'GAP_REDUCE_1S',
    category: 'GAP_CLOSING',
    difficulty: 'MEDIUM',
    template: 'Can {driver1} find a second on {driver2} over the next {windowSize} laps?',
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
    template: '{driver1} is closing fast — can he shave 2 seconds off {driver2} in the next {windowSize} laps?',
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
    template: 'The gap is tightening — will {driver1} drop inside 1 second of {driver2} in the next 2 laps?',
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
    id: 'GAP_STAY_CLOSE',
    category: 'GAP_CLOSING',
    difficulty: 'EASY',
    template: 'Will {driver1} stay glued to {driver2}\'s gearbox for the next 2 laps?',
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
    id: 'GAP_SLIP_BACK',
    category: 'GAP_CLOSING',
    difficulty: 'MEDIUM',
    template: 'Is {driver1} losing touch with {driver2} — will he slip back beyond 1 second in the next 2 laps?',
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
    template: 'Final laps, wheel-to-wheel — will {driver1} beat {driver2} to the flag?',
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
    template: 'Can {driver1} hold a top-5 spot over the next {windowSize} laps?',
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
    template: 'Podium within reach — will {driver1} crack the top 3 in the next {windowSize} laps?',
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
    template: 'Points on the line — will {driver1} stay inside the top 10 after the next {windowSize} laps?',
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
    template: 'P{position} under pressure — can {driver1} defend their spot for the next 2 laps?',
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
    template: 'The podium looks set — will {driver1} still be there in 2 laps?',
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
  {
    id: 'FIN_LEAD_DEFEND',
    category: 'FINISH_POSITION',
    difficulty: 'HARD',
    template: 'Late-race nerves — can {driver1} hold the lead for the next 2 laps?',
    windowSize: 2,
    triggers: [
      { type: 'lateRacePhase', params: {} },
      { type: 'positionRange', params: { min: 1, max: 1 } },
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
  OVERTAKE: 'Make the Move',
  PIT_WINDOW: 'Strategy Call',
  GAP_CLOSING: 'The Chase',
  FINISH_POSITION: 'Final Stretch',
};

export const DIFFICULTY_INFO: Record<string, { name: string; color: string; points: number }> = {
  EASY: { name: 'Easy', color: 'green', points: 10 },
  MEDIUM: { name: 'Medium', color: 'yellow', points: 15 },
  HARD: { name: 'Hard', color: 'red', points: 25 },
};
