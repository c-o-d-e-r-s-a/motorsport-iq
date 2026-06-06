import type { OpenF1Session } from '../types';

/**
 * Emergency schedule fallback when OpenF1 `/sessions` is unreachable (cold start,
 * live-lock, outage). Update at the start of each race weekend.
 */
export const SCHEDULE_OVERRIDES: OpenF1Session[] = [
  {
    session_key: 11299,
    meeting_key: 1286,
    location: 'Monaco',
    session_type: 'Race',
    session_name: 'Race',
    date_start: '2026-06-07T13:00:00+00:00',
    date_end: '2026-06-07T15:00:00+00:00',
    country_key: 95,
    country_code: 'MCO',
    country_name: 'Monaco',
    circuit_key: 6,
    circuit_short_name: 'Monte Carlo',
    year: 2026,
  },
];
