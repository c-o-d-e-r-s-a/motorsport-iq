import type { OpenF1RaceControl } from '../types';
import {
  parseLatestRaceControlStatus,
  parseRaceControlMessageStatus,
  parseTrackStatusPayload,
} from './raceStatus';

function raceControl(overrides: Partial<OpenF1RaceControl> = {}): OpenF1RaceControl {
  return {
    date: '2026-06-14T14:00:00Z',
    session_key: 11307,
    meeting_key: 1287,
    category: 'Flag',
    flag: 'GREEN',
    scope: 'Track',
    sector: 0,
    driver_number: 0,
    message: 'GREEN FLAG',
    lap_number: 45,
    ...overrides,
  };
}

describe('raceStatus parsing', () => {
  it('maps live timing TrackStatus codes for every global race state', () => {
    expect(parseTrackStatusPayload({ statusCode: '1' })).toBe('GREEN');
    expect(parseTrackStatusPayload({ statusCode: '2' })).toBe('YELLOW');
    expect(parseTrackStatusPayload({ statusCode: '4' })).toBe('SC');
    expect(parseTrackStatusPayload({ statusCode: '5' })).toBe('RED');
    expect(parseTrackStatusPayload({ statusCode: '6' })).toBe('VSC');
    expect(parseTrackStatusPayload({ statusCode: '7' })).toBe('VSC');
    expect(parseTrackStatusPayload({ statusCode: '21' })).toBe('CHEQUERED');
  });

  it('ignores sector yellow race-control messages instead of making them global', () => {
    expect(parseRaceControlMessageStatus(raceControl({
      flag: 'YELLOW',
      scope: 'Sector',
      sector: 2,
      message: 'Yellow flag in sector 2',
    }))).toBeNull();
  });

  it('keeps the latest global clear when a newer local yellow is present', () => {
    const status = parseLatestRaceControlStatus([
      raceControl({
        date: '2026-06-14T14:00:00Z',
        flag: 'GREEN',
        scope: 'Track',
        message: 'Track clear',
      }),
      raceControl({
        date: '2026-06-14T14:01:00Z',
        flag: 'YELLOW',
        scope: 'Sector',
        sector: 7,
        message: 'Yellow flag in sector 7',
      }),
    ]);

    expect(status).toBe('GREEN');
  });

  it('still accepts global yellow, red, VSC, SC, and chequered race-control messages', () => {
    expect(parseRaceControlMessageStatus(raceControl({
      flag: 'YELLOW',
      message: 'Yellow flag',
    }))).toBe('YELLOW');
    expect(parseRaceControlMessageStatus(raceControl({
      flag: 'RED',
      message: 'Red flag',
    }))).toBe('RED');
    expect(parseRaceControlMessageStatus(raceControl({
      category: 'SafetyCar',
      flag: 'VSC',
      message: 'Virtual Safety Car deployed',
    }))).toBe('VSC');
    expect(parseRaceControlMessageStatus(raceControl({
      category: 'SafetyCar',
      flag: 'SC',
      message: 'Safety Car deployed',
    }))).toBe('SC');
    expect(parseRaceControlMessageStatus(raceControl({
      flag: 'CHEQUERED',
      message: 'Chequered flag',
    }))).toBe('CHEQUERED');
  });
});
