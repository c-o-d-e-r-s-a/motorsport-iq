/** Keep in sync with frontend/src/lib/answerWindow.ts */
export const TRIGGER_TO_LIVE_MS = 1000;
export const ANSWER_WINDOW_MS = 45000;

/** Minimum time to show resolution + meme before the next question may trigger. */
export const POST_RESOLUTION_DISPLAY_MS = 35_000;

/** Total offset from trigger to answer deadline (1s delay + 45s window). */
export const LIVE_ANSWER_DEADLINE_OFFSET_MS = TRIGGER_TO_LIVE_MS + ANSWER_WINDOW_MS;

export function computeLiveAnswerDeadlineFromTrigger(triggeredAt: Date): Date {
  return new Date(triggeredAt.getTime() + LIVE_ANSWER_DEADLINE_OFFSET_MS);
}

/**
 * Resolve the authoritative answer deadline for a LIVE question.
 * Prefers the in-memory deadline set at LIVE transition; falls back to trigger math.
 */
export function resolveLiveAnswerDeadline(
  triggeredAt: Date,
  inMemoryDeadline?: Date | null,
  instanceDeadline?: Date | null
): Date {
  return inMemoryDeadline ?? instanceDeadline ?? computeLiveAnswerDeadlineFromTrigger(triggeredAt);
}
