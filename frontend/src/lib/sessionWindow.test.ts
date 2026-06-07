import { describe, expect, it } from '@jest/globals';
import { isSessionCompleted, isSessionLive } from './sessionWindow';
import type { SessionInfo } from './types';

const monacoRace: Pick<SessionInfo, 'date_start' | 'date_end' | 'session_name'> = {
  session_name: 'Race',
  date_start: '2026-06-07T13:00:00+00:00',
  date_end: '2026-06-07T17:00:00+00:00',
};

describe('sessionWindow', () => {
  it('keeps Monaco live shortly after scheduled end', () => {
    const duringRedFlag = new Date('2026-06-07T15:30:00Z').getTime();
    expect(isSessionLive(monacoRace, duringRedFlag)).toBe(true);
    expect(isSessionCompleted(monacoRace, duringRedFlag)).toBe(false);
  });

  it('marks Monaco completed only after overtime expires', () => {
    const afterOvertime = new Date('2026-06-07T20:01:00Z').getTime();
    expect(isSessionLive(monacoRace, afterOvertime)).toBe(false);
    expect(isSessionCompleted(monacoRace, afterOvertime)).toBe(true);
  });
});
