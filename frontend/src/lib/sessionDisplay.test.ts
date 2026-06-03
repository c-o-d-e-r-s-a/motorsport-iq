import { describe, expect, it } from '@jest/globals';
import type { SessionInfo } from './types';
import {
  filterSessionsForDisplay,
  isLivePlayableWindow,
  isPlayableLiveSession,
} from './sessionDisplay';

const liveRace: SessionInfo = {
  session_key: 11291,
  meeting_key: 1285,
  location: 'Montréal',
  session_type: 'Race',
  session_name: 'Race',
  date_start: '2026-05-24T20:00:00+00:00',
  date_end: '2026-05-24T22:00:00+00:00',
  country_name: 'Canada',
  circuit_short_name: 'Montreal',
  year: 2026,
  isCompleted: false,
  isLive: true,
  mode: 'live',
};

const completedSprint: SessionInfo = {
  ...liveRace,
  session_key: 11286,
  session_name: 'Sprint',
  date_start: '2026-05-23T16:00:00+00:00',
  date_end: '2026-05-23T17:00:00+00:00',
  isLive: false,
  isCompleted: true,
  mode: 'replay',
};

const monacoRace: SessionInfo = {
  session_key: 11295,
  meeting_key: 1286,
  location: 'Monaco',
  session_type: 'Race',
  session_name: 'Race',
  date_start: '2026-06-07T13:00:00+00:00',
  date_end: '2026-06-07T15:00:00+00:00',
  country_name: 'Monaco',
  circuit_short_name: 'Monte Carlo',
  year: 2026,
  isCompleted: true,
  isLive: false,
  mode: 'replay',
};

describe('sessionDisplay', () => {
  it('identifies live Race and Sprint sessions', () => {
    expect(isPlayableLiveSession(liveRace)).toBe(true);
    expect(isPlayableLiveSession(completedSprint)).toBe(false);
    expect(isPlayableLiveSession(monacoRace)).toBe(false);
  });

  it('returns only the live playable session when one is live', () => {
    const filtered = filterSessionsForDisplay([
      liveRace,
      completedSprint,
      monacoRace,
    ]);

    expect(filtered).toEqual([liveRace]);
  });

  it('leaves the session list unchanged when no Race/Sprint is live', () => {
    const sessions = [completedSprint, monacoRace];
    expect(filterSessionsForDisplay(sessions)).toEqual(sessions);
  });

  it('detects a live playable window', () => {
    expect(isLivePlayableWindow([liveRace, monacoRace])).toBe(true);
    expect(isLivePlayableWindow([completedSprint, monacoRace])).toBe(false);
  });
});
