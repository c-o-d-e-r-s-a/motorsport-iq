import type { RaceSnapshot, QuestionInstanceState } from '../types';
import { getQuestionById } from './questionBank';
import { getDriverByNumber } from './derivedSignals';

function isFinishPositionQuestion(questionId: string): boolean {
  return getQuestionById(questionId)?.category === 'FINISH_POSITION';
}

function hasFinalLapCompleted(snapshot: RaceSnapshot): boolean {
  if (snapshot.trackStatus === 'CHEQUERED') {
    return true;
  }

  if (!snapshot.totalLaps) {
    return false;
  }

  // Live/replay feeds advance lapNumber to totalLaps + 1 once the final lap completes.
  return snapshot.lapNumber > snapshot.totalLaps;
}

export interface ResolutionResult {
  instanceId: string;
  outcome: boolean;
  correctAnswer: 'YES' | 'NO';
  explanation: string;
}

/**
 * Resolution Engine - Evaluates question outcomes
 * Resolution only happens on lap completion
 */

/**
 * Check if a question instance should be resolved
 */
export function shouldResolve(
  instance: QuestionInstanceState,
  currentSnapshot: RaceSnapshot
): boolean {
  // Only resolve questions in ACTIVE state
  if (instance.state !== 'ACTIVE') {
    return false;
  }

  // Check if we've reached the target lap
  if (isFinishPositionQuestion(instance.questionId)) {
    if (hasFinalLapCompleted(currentSnapshot)) {
      return true;
    }
  } else if (currentSnapshot.lapNumber >= instance.targetLap) {
    return true;
  }

  // Check if either driver has retired
  const driver1 = getDriverByNumber(currentSnapshot, instance.driver1?.driverNumber ?? 0);
  if (driver1?.retired) {
    return true;
  }

  if (instance.driver2) {
    const driver2 = getDriverByNumber(currentSnapshot, instance.driver2.driverNumber);
    if (driver2?.retired) {
      return true;
    }
  }

  return false;
}

/**
 * Resolve a question and determine the outcome
 */
export function resolveQuestion(
  instance: QuestionInstanceState,
  currentSnapshot: RaceSnapshot
): ResolutionResult {
  const question = getQuestionById(instance.questionId);
  if (!question) {
    throw new Error(`Question not found: ${instance.questionId}`);
  }

  // Hard rule: if a driver the question is about crashes out or retires, the
  // prediction instantly fails ("No") rather than waiting for the lap window to
  // elapse or letting frozen telemetry produce a misleading "Yes".
  const retired = getRetiredQuestionDriver(instance, currentSnapshot);
  if (retired) {
    return {
      instanceId: instance.id,
      outcome: false,
      correctAnswer: 'NO',
      explanation: `No — ${retired} is out of the race, so this prediction can no longer come true.`,
    };
  }

  const outcome = evaluateSuccessCondition(question.successCondition, instance, currentSnapshot);
  const correctAnswer: 'YES' | 'NO' = outcome ? 'YES' : 'NO';
  const explanation = generateExplanation(instance, currentSnapshot, outcome, question.successCondition.type);

  return {
    instanceId: instance.id,
    outcome,
    correctAnswer,
    explanation,
  };
}

/**
 * Returns the name of a question's subject driver who has retired/crashed out,
 * or null if both are still running.
 */
function getRetiredQuestionDriver(
  instance: QuestionInstanceState,
  currentSnapshot: RaceSnapshot
): string | null {
  const driver1 = instance.driver1
    ? getDriverByNumber(currentSnapshot, instance.driver1.driverNumber)
    : null;
  if (driver1?.retired) {
    return instance.driver1?.name ?? driver1.name;
  }

  if (instance.driver2) {
    const driver2 = getDriverByNumber(currentSnapshot, instance.driver2.driverNumber);
    if (driver2?.retired) {
      return instance.driver2.name ?? driver2.name;
    }
  }

  return null;
}

/**
 * Evaluate a success condition
 */
export function evaluateSuccessCondition(
  condition: { type: string; params: Record<string, unknown> },
  instance: QuestionInstanceState,
  currentSnapshot: RaceSnapshot
): boolean {
  const triggerDriver1 = instance.driver1;
  const triggerDriver2 = instance.driver2;

  if (!triggerDriver1) {
    return false;
  }

  // Get current state of drivers
  const currentDriver1 = getDriverByNumber(currentSnapshot, triggerDriver1.driverNumber);
  const currentDriver2 = triggerDriver2
    ? getDriverByNumber(currentSnapshot, triggerDriver2.driverNumber)
    : null;

  if (!currentDriver1) {
    // Driver retired or left race
    return false;
  }

  switch (condition.type) {
    case 'pitStop': {
      const withinLaps = condition.params.withinLaps as number;
      const pitCountBefore = triggerDriver1.pitCount;
      const pitCountNow = currentDriver1.pitCount;
      return pitCountNow > pitCountBefore && currentSnapshot.lapNumber - instance.triggerSnapshot.lapNumber <= withinLaps;
    }

    case 'noPitStop': {
      const withinLaps = condition.params.withinLaps as number;
      const pitCountBefore = triggerDriver1.pitCount;
      const pitCountNow = currentDriver1.pitCount;
      return pitCountNow === pitCountBefore && currentSnapshot.lapNumber - instance.triggerSnapshot.lapNumber <= withinLaps;
    }

    case 'overtake': {
      if (!triggerDriver2 || !currentDriver2) return false;
      // Overtake happened if driver1's position improved and they're now ahead of driver2
      const wasBehind = triggerDriver1.position > triggerDriver2.position;
      const isAhead = currentDriver1.position < currentDriver2.position;
      return wasBehind && isAhead;
    }

    case 'positionReached': {
      const targetPosition = condition.params.targetPosition as number;
      return currentDriver1.position <= targetPosition;
    }

    case 'positionGain': {
      const minGain = condition.params.minGain as number;
      const positionsGained = triggerDriver1.position - currentDriver1.position;
      return positionsGained >= minGain;
    }

    case 'gapReduced': {
      if (!triggerDriver2 || !currentDriver2) return false;
      const minReduction = condition.params.minReduction as number;
      const triggerGap = Math.abs(
        (triggerDriver1.gap ?? 0) - (triggerDriver2.gap ?? 0)
      );
      const currentGap = Math.abs(
        (currentDriver1.gap ?? 0) - (currentDriver2.gap ?? 0)
      );
      return triggerGap - currentGap >= minReduction;
    }

    case 'gapReached': {
      if (!triggerDriver2 || !currentDriver2) return false;
      const targetGap = condition.params.targetGap as number;
      const currentGap = Math.abs(
        (currentDriver1.gap ?? 0) - (currentDriver2.gap ?? 0)
      );
      return currentGap <= targetGap;
    }

    case 'finalPosition': {
      const maxPosition = condition.params.maxPosition as number;
      return currentDriver1.position <= maxPosition;
    }

    case 'finishAhead': {
      if (!triggerDriver2 || !currentDriver2) return false;
      return currentDriver1.position < currentDriver2.position;
    }

    case 'maintainPosition': {
      return currentDriver1.position === triggerDriver1.position;
    }

    case 'stillWithinGap': {
      const targetGap = condition.params.targetGap as number;
      return currentDriver1.interval !== null && currentDriver1.interval <= targetGap;
    }

    case 'gapExceeded': {
      const targetGap = condition.params.targetGap as number;
      return currentDriver1.interval === null || currentDriver1.interval > targetGap;
    }

    default:
      console.warn(`Unknown success condition type: ${condition.type}`);
      return false;
  }
}

/**
 * Generate an explanation for the outcome
 */
export function generateExplanation(
  instance: QuestionInstanceState,
  currentSnapshot: RaceSnapshot,
  outcome: boolean,
  conditionType: string
): string {
  const driver1Name = instance.driver1?.name ?? 'Driver';
  const driver2Name = instance.driver2?.name ?? 'the car ahead';
  const triggerDriver1 = instance.driver1;
  const currentDriver1 = triggerDriver1
    ? getDriverByNumber(currentSnapshot, triggerDriver1.driverNumber)
    : null;

  const yesNo = outcome ? 'Yes' : 'No';
  const didDidNot = outcome ? 'did' : 'did not';

  switch (conditionType) {
    case 'pitStop':
      return `${yesNo}! ${driver1Name} ${didDidNot} pit within the specified window. Tyre age was ${triggerDriver1?.tyreAge ?? 0} laps at trigger.`;

    case 'noPitStop':
      return `${yesNo}! ${driver1Name} ${outcome ? 'stayed out' : 'came in'} during the prediction window.`;

    case 'overtake':
      return `${yesNo}! ${driver1Name} ${didDidNot} overtake ${driver2Name}. Position change: ${triggerDriver1?.position} → ${currentDriver1?.position}.`;

    case 'positionReached':
      return `${yesNo}! ${driver1Name} ${outcome ? 'reached' : 'did not reach'} the target position. Current: P${currentDriver1?.position}.`;

    case 'positionGain':
      const positionsGained = (triggerDriver1?.position ?? 0) - (currentDriver1?.position ?? 0);
      return `${yesNo}! ${driver1Name} gained ${positionsGained} position(s). Started P${triggerDriver1?.position}, now P${currentDriver1?.position}.`;

    case 'gapReduced':
      return `${yesNo}! The gap ${outcome ? 'decreased' : 'did not decrease enough'} between ${driver1Name} and ${driver2Name}.`;

    case 'gapReached':
      return `${yesNo}! ${driver1Name} ${outcome ? 'closed to within' : 'did not close to'} the target gap to ${driver2Name}.`;

    case 'finalPosition':
      return `${yesNo}! ${driver1Name} ${outcome ? 'finished in' : 'did not finish in'} the target position. Final: P${currentDriver1?.position}.`;

    case 'finishAhead':
      return `${yesNo}! ${driver1Name} finished ${outcome ? 'ahead of' : 'behind'} ${driver2Name}.`;

    case 'maintainPosition':
      return `${yesNo}! ${driver1Name} ${outcome ? 'held' : 'lost'} P${triggerDriver1?.position}. Now P${currentDriver1?.position}.`;

    case 'stillWithinGap':
      return `${yesNo}! ${driver1Name} ${outcome ? 'stayed within' : 'fell outside of'} 1 second behind ${driver2Name}.`;

    case 'gapExceeded':
      return `${yesNo}! ${driver1Name} ${outcome ? 'dropped back beyond' : 'stayed within'} 1 second of ${driver2Name}.`;

    default:
      return `${yesNo}! The prediction ${didDidNot} come true for ${driver1Name}.`;
  }
}

/**
 * Check if a question should be cancelled due to race conditions
 */
export function shouldCancel(
  instance: QuestionInstanceState,
  currentSnapshot: RaceSnapshot
): { cancel: boolean; reason: string } | null {
  // Cancel if track status is SC or VSC and question is not locked
  if (['TRIGGERED', 'LIVE'].includes(instance.state)) {
    if (currentSnapshot.trackStatus === 'SC') {
      return { cancel: true, reason: 'Safety Car deployed' };
    }
    if (currentSnapshot.trackStatus === 'VSC') {
      return { cancel: true, reason: 'Virtual Safety Car deployed' };
    }
  }

  // NOTE: driver retirement is intentionally NOT a cancellation. Per the game's
  // hard rules a question about a driver who crashes out or retires must resolve
  // instantly as "No"/Fail (handled in shouldResolve + resolveQuestion), not be
  // silently cancelled.

  // Cancel if red flag
  if (currentSnapshot.trackStatus === 'RED') {
    return { cancel: true, reason: 'Red flag' };
  }

  return null;
}

/**
 * Check if a question should be paused (SC/VSC after lock)
 */
export function shouldPause(
  instance: QuestionInstanceState,
  currentSnapshot: RaceSnapshot
): boolean {
  if (instance.state === 'LOCKED' || instance.state === 'ACTIVE') {
    return currentSnapshot.trackStatus === 'SC' || currentSnapshot.trackStatus === 'VSC';
  }
  return false;
}

/**
 * Check if a paused question should resume
 */
export function shouldResume(
  instance: QuestionInstanceState,
  currentSnapshot: RaceSnapshot
): boolean {
  // This would need additional state tracking for "paused" status
  // For now, just check if green flag is back
  return currentSnapshot.trackStatus === 'GREEN';
}
