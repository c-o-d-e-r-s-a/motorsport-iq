import {
  ANSWER_WINDOW_MS,
  LIVE_ANSWER_DEADLINE_OFFSET_MS,
  TRIGGER_TO_LIVE_MS,
  computeLiveAnswerDeadlineFromTrigger,
  resolveLiveAnswerDeadline,
} from './answerWindow';

describe('answerWindow', () => {
  it('exports timing constants in sync with lifecycle manager', () => {
    expect(TRIGGER_TO_LIVE_MS).toBe(1000);
    expect(ANSWER_WINDOW_MS).toBe(45000);
    expect(LIVE_ANSWER_DEADLINE_OFFSET_MS).toBe(46000);
  });

  it('computes live deadline from trigger time', () => {
    const triggeredAt = new Date('2025-01-01T00:00:00.000Z');
    expect(computeLiveAnswerDeadlineFromTrigger(triggeredAt).toISOString()).toBe(
      '2025-01-01T00:00:46.000Z'
    );
  });

  it('prefers in-memory deadline over trigger fallback', () => {
    const triggeredAt = new Date('2025-01-01T00:00:00.000Z');
    const inMemory = new Date('2025-01-01T00:00:40.000Z');
    expect(resolveLiveAnswerDeadline(triggeredAt, inMemory).toISOString()).toBe(
      inMemory.toISOString()
    );
  });

  it('falls back to trigger math when no in-memory deadline', () => {
    const triggeredAt = new Date('2025-01-01T00:00:00.000Z');
    expect(resolveLiveAnswerDeadline(triggeredAt, null).toISOString()).toBe(
      '2025-01-01T00:00:46.000Z'
    );
  });
});
