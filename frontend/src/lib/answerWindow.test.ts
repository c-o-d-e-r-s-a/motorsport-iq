import {
  ANSWER_WINDOW_MS,
  computeAnswerDeadlineFallback,
  computeCountdownSeconds,
  LIVE_ANSWER_DEADLINE_OFFSET_MS,
  resolveAnswerDeadline,
} from './answerWindow';

describe('answerWindow', () => {
  it('computes fallback deadline from trigger + 1s delay + 45s window', () => {
    const triggeredAt = '2025-01-01T00:00:00.000Z';
    expect(computeAnswerDeadlineFallback(triggeredAt)).toBe(
      new Date(new Date(triggeredAt).getTime() + LIVE_ANSWER_DEADLINE_OFFSET_MS).toISOString()
    );
  });

  it('prefers server answerDeadline over fallback', () => {
    const serverDeadline = '2025-01-01T00:00:30.000Z';
    expect(resolveAnswerDeadline(serverDeadline, '2025-01-01T00:00:00.000Z', 'LIVE')).toBe(serverDeadline);
  });

  it('uses fallback only when LIVE and no server deadline', () => {
    const triggeredAt = '2025-01-01T00:00:00.000Z';
    expect(resolveAnswerDeadline(undefined, triggeredAt, 'LIVE')).toBe(
      computeAnswerDeadlineFallback(triggeredAt)
    );
    expect(resolveAnswerDeadline(undefined, triggeredAt, 'TRIGGERED')).toBeNull();
  });

  describe('computeCountdownSeconds', () => {
    it('shows exactly 45 at LIVE start (45000ms remaining)', () => {
      expect(computeCountdownSeconds(45000, ANSWER_WINDOW_MS)).toBe(45);
    });

    it('caps ceil rounding so 45001–45999ms never displays above 45', () => {
      expect(computeCountdownSeconds(45001, ANSWER_WINDOW_MS)).toBe(45);
      expect(computeCountdownSeconds(45999, ANSWER_WINDOW_MS)).toBe(45);
    });

    it('shows accurate remaining time for reconnect mid-window', () => {
      expect(computeCountdownSeconds(30000, ANSWER_WINDOW_MS)).toBe(30);
      expect(computeCountdownSeconds(1001, ANSWER_WINDOW_MS)).toBe(2);
    });

    it('returns 0 when expired', () => {
      expect(computeCountdownSeconds(0, ANSWER_WINDOW_MS)).toBe(0);
    });
  });
});
