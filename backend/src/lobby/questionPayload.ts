import type {
  Difficulty,
  DriverState,
  InstanceState,
  QuestionCategory,
  QuestionContext,
  QuestionContextDriver,
  QuestionEvent,
  QuestionInstanceState,
} from '../types';
import { computeLiveAnswerDeadlineFromTrigger } from './answerWindow';

const UNRESOLVED_STATES: ReadonlySet<InstanceState> = new Set(['TRIGGERED', 'LIVE', 'LOCKED', 'ACTIVE']);

export function isUnresolvedQuestionState(state: InstanceState): boolean {
  return UNRESOLVED_STATES.has(state);
}

function toContextDriver(driver: DriverState): QuestionContextDriver {
  return {
    name: driver.name,
    team: driver.team,
    position: driver.position,
    interval: driver.interval,
    tyreCompound: driver.tyreCompound,
    tyreAge: driver.tyreAge,
    stintNumber: driver.stintNumber,
    overtakeModeArmed: driver.overtakeModeArmed,
  };
}

/** Build frozen driver context from trigger-time instance state. */
export function buildQuestionContext(
  instance: Pick<QuestionInstanceState, 'driver1' | 'driver2' | 'triggerSnapshot' | 'questionContext'>
): QuestionContext | undefined {
  if (instance.questionContext) {
    return instance.questionContext;
  }

  if (!instance.driver1) {
    return undefined;
  }

  return {
    triggerLap: instance.triggerSnapshot.lapNumber,
    driver1: toContextDriver(instance.driver1),
    driver2: instance.driver2 ? toContextDriver(instance.driver2) : undefined,
  };
}

interface BuildQuestionEventOptions {
  answerDeadline?: Date | null;
}

export function buildQuestionEventPayload(
  instance: QuestionInstanceState,
  category: QuestionCategory,
  difficulty: Difficulty,
  options: BuildQuestionEventOptions = {}
): QuestionEvent {
  const questionContext = buildQuestionContext(instance);

  const payload: QuestionEvent = {
    instanceId: instance.id,
    questionId: instance.questionId,
    questionText: instance.questionText ?? 'Question in progress',
    category,
    difficulty,
    state: instance.state,
    windowSize: instance.windowSize,
    triggeredAt: instance.triggeredAt.toISOString(),
    suggestedStatKeys: instance.suggestedStatKeys ?? [],
    questionContext,
  };

  const answerDeadline = options.answerDeadline ?? instance.answerDeadline ?? (
    instance.state === 'LIVE'
      ? computeLiveAnswerDeadlineFromTrigger(instance.triggeredAt)
      : null
  );
  if (answerDeadline) {
    payload.answerDeadline = answerDeadline instanceof Date
      ? answerDeadline.toISOString()
      : answerDeadline;
  }

  return payload;
}
