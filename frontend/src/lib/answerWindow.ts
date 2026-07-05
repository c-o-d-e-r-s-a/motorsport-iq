/** Keep in sync with backend/src/lobby/answerWindow.ts */
export const TRIGGER_TO_LIVE_MS = 1000;
export const ANSWER_WINDOW_MS = 45000;

/** Minimum time to show resolution + meme before accepting the next question. */
export const POST_RESOLUTION_DISPLAY_MS = 35_000;

export const LIVE_ANSWER_DEADLINE_OFFSET_MS = TRIGGER_TO_LIVE_MS + ANSWER_WINDOW_MS;

export function computeAnswerDeadlineFallback(triggeredAt: string | Date): string {
  const triggerMs = typeof triggeredAt === 'string'
    ? new Date(triggeredAt).getTime()
    : triggeredAt.getTime();
  return new Date(triggerMs + LIVE_ANSWER_DEADLINE_OFFSET_MS).toISOString();
}

/**
 * Display-only countdown seconds. Caps at the answer window so ceil rounding
 * never shows 46+ when the server deadline is authoritative.
 */
export function computeCountdownSeconds(
  timeRemainingMs: number,
  totalDurationMs: number = ANSWER_WINDOW_MS
): number {
  if (timeRemainingMs <= 0) {
    return 0;
  }
  const maxSeconds = Math.ceil(totalDurationMs / 1000);
  return Math.min(maxSeconds, Math.ceil(timeRemainingMs / 1000));
}

export function resolveAnswerDeadline(
  answerDeadline: string | undefined,
  triggeredAt: string,
  questionState: string | null | undefined
): string | null {
  if (answerDeadline) {
    return answerDeadline;
  }
  if (questionState === 'LIVE') {
    return computeAnswerDeadlineFallback(triggeredAt);
  }
  return null;
}
