import type { OpenF1Session } from '../../types';
import { SCHEDULE_OVERRIDES } from '../scheduleOverrides';

/** Test-only fixture for completed Canadian GP 2026 (not used in production overrides). */
export const CANADIAN_GP_2026_SESSIONS: OpenF1Session[] = [
  {
    session_key: 11282,
    meeting_key: 1285,
    location: 'Montréal',
    session_type: 'Qualifying',
    session_name: 'Sprint Qualifying',
    date_start: '2026-05-22T20:30:00+00:00',
    date_end: '2026-05-22T21:14:00+00:00',
    country_key: 46,
    country_code: 'CAN',
    country_name: 'Canada',
    circuit_key: 23,
    circuit_short_name: 'Montreal',
    year: 2026,
  },
  {
    session_key: 11286,
    meeting_key: 1285,
    location: 'Montréal',
    session_type: 'Race',
    session_name: 'Sprint',
    date_start: '2026-05-23T16:00:00+00:00',
    date_end: '2026-05-23T17:00:00+00:00',
    country_key: 46,
    country_code: 'CAN',
    country_name: 'Canada',
    circuit_key: 23,
    circuit_short_name: 'Montreal',
    year: 2026,
  },
  {
    session_key: 11288,
    meeting_key: 1285,
    location: 'Montréal',
    session_type: 'Qualifying',
    session_name: 'Qualifying',
    date_start: '2026-05-23T20:00:00+00:00',
    date_end: '2026-05-23T21:00:00+00:00',
    country_key: 46,
    country_code: 'CAN',
    country_name: 'Canada',
    circuit_key: 23,
    circuit_short_name: 'Montreal',
    year: 2026,
  },
  {
    session_key: 11291,
    meeting_key: 1285,
    location: 'Montréal',
    session_type: 'Race',
    session_name: 'Race',
    date_start: '2026-05-24T20:00:00+00:00',
    date_end: '2026-05-24T22:00:00+00:00',
    country_key: 46,
    country_code: 'CAN',
    country_name: 'Canada',
    circuit_key: 23,
    circuit_short_name: 'Montreal',
    year: 2026,
  },
];

export const MONACO_GP_2026_RACE: OpenF1Session = SCHEDULE_OVERRIDES.find(
  (session) => session.session_key === 11295
)!;

export const SEASON_2026_FIXTURE: OpenF1Session[] = [
  ...CANADIAN_GP_2026_SESSIONS,
  MONACO_GP_2026_RACE,
];
