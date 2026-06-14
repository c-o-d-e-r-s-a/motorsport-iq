import type { OpenF1Session } from '../types';
import {
  getUpcomingGrandPrixRaces,
  shouldSendRaceReminder,
} from './raceReminderLogic';

function buildRaceSession(overrides: Partial<OpenF1Session> = {}): OpenF1Session {
  return {
    session_key: 11326,
    meeting_key: 1289,
    location: 'Silverstone',
    session_type: 'Race',
    session_name: 'Race',
    date_start: '2026-07-05T14:00:00+00:00',
    date_end: '2026-07-05T17:00:00+00:00',
    country_key: 2,
    country_code: 'GBR',
    country_name: 'United Kingdom',
    circuit_key: 2,
    circuit_short_name: 'Silverstone',
    year: 2026,
    ...overrides,
  };
}

describe('raceReminderScheduler', () => {
  it('only targets upcoming Race sessions', () => {
    const now = new Date('2026-07-05T13:00:00+00:00').getTime();
    const sessions = [
      buildRaceSession(),
      buildRaceSession({ session_key: 11321, session_name: 'Sprint' }),
      buildRaceSession({ session_key: 11300, date_start: '2026-06-01T13:00:00+00:00' }),
    ];

    const upcoming = getUpcomingGrandPrixRaces(2026, now, () => sessions);

    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]?.session_key).toBe(11326);
  });

  it('fires inside the 30-minute reminder window', () => {
    const raceStart = new Date('2026-07-05T14:00:00+00:00').getTime();
    const session = buildRaceSession();

    expect(shouldSendRaceReminder(session, raceStart - (30 * 60 * 1000))).toBe(true);
    expect(shouldSendRaceReminder(session, raceStart - (31 * 60 * 1000))).toBe(false);
    expect(shouldSendRaceReminder(session, raceStart - (20 * 60 * 1000))).toBe(false);
  });
});
