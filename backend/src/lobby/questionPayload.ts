import type {
  Difficulty,
  InstanceState,
  QuestionCategory,
  QuestionEvent,
  QuestionInstanceState,
} from '../types';

const UNRESOLVED_STATES: ReadonlySet<InstanceState> = new Set(['TRIGGERED', 'LIVE', 'LOCKED', 'ACTIVE']);

export function isUnresolvedQuestionState(state: InstanceState): boolean {
  return UNRESOLVED_STATES.has(state);
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
  };

  const answerDeadline = options.answerDeadline ?? instance.answerDeadline ?? null;
  if (answerDeadline) {
    payload.answerDeadline = answerDeadline.toISOString();
  }

  return payload;
}
