import { describe, expect, it } from '@jest/globals';
import type { SessionInfo } from './types';
import {
  filterSessionsForDisplay,
  isCanadianGrandPrixSession,
  isLiveCanadianGrandPrixWindow,
} from './sessionDisplay';

const canadianGpRace: SessionInfo = {
  session_key: 99004,
  meeting_key: 99000,
  location: 'Montréal',
  session_type: 'Race',
  session_name: 'Race',
  date_start: '2026-05-24T20:00:00+00:00',
  date_end: '2026-05-24T22:00:00+00:00',
  country_name: 'Canada',
  circuit_short_name: 'Montréal',
  year: 2026,
  isCompleted: false,
  isLive: true,
  mode: 'live',
};

const canadianSprint: SessionInfo = {
  ...canadianGpRace,
  session_key: 99002,
  session_name: 'Sprint',
  date_start: '2026-05-23T16:00:00+00:00',
  date_end: '2026-05-23T17:00:00+00:00',
  isLive: false,
  isCompleted: true,
  mode: 'replay',
};

const monacoRace: SessionInfo = {
  session_key: 12345,
  meeting_key: 12000,
  location: 'Monaco',
  session_type: 'Race',
  session_name: 'Race',
  date_start: '2026-05-10T13:00:00+00:00',
  date_end: '2026-05-10T15:00:00+00:00',
  country_name: 'Monaco',
  circuit_short_name: 'Monte Carlo',
  year: 2026,
  isCompleted: true,
  isLive: false,
  mode: 'replay',
};

describe('sessionDisplay', () => {
  it('identifies the Canadian Grand Prix race session', () => {
    expect(isCanadianGrandPrixSession(canadianGpRace)).toBe(true);
    expect(isCanadianGrandPrixSession(canadianSprint)).toBe(false);
    expect(isCanadianGrandPrixSession(monacoRace)).toBe(false);
  });

  it('returns only the live Canadian Grand Prix when the race is live', () => {
    const filtered = filterSessionsForDisplay([
      canadianGpRace,
      canadianSprint,
      monacoRace,
    ]);

    expect(filtered).toEqual([canadianGpRace]);
  });

  it('leaves the session list unchanged when the Canadian GP is not live', () => {
    const sessions = [canadianSprint, monacoRace];
    expect(filterSessionsForDisplay(sessions)).toEqual(sessions);
  });

  it('detects the live Canadian Grand Prix window', () => {
    expect(isLiveCanadianGrandPrixWindow([canadianGpRace, monacoRace])).toBe(true);
    expect(isLiveCanadianGrandPrixWindow([canadianSprint, monacoRace])).toBe(false);
  });
});
