import type { OpenF1RaceControl } from '../types';
import {
  classifySectorFlag,
  isRaceNeutralized,
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
  it('identifies only SC, VSC, and RED as race-neutralizing statuses', () => {
    expect(isRaceNeutralized('SC')).toBe(true);
    expect(isRaceNeutralized('VSC')).toBe(true);
    expect(isRaceNeutralized('RED')).toBe(true);
    expect(isRaceNeutralized('YELLOW')).toBe(false);
    expect(isRaceNeutralized('GREEN')).toBe(false);
    expect(isRaceNeutralized('CHEQUERED')).toBe(false);
  });

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

  it('ignores ambiguous global-yellow rows without explicit track scope or text', () => {
    expect(parseRaceControlMessageStatus(raceControl({
      flag: 'YELLOW',
      scope: '',
      sector: 0,
      message: 'YELLOW',
    }))).toBeNull();
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

  it('does not treat safety car line steward messages as SC', () => {
    expect(parseRaceControlMessageStatus(raceControl({
      category: 'Other',
      flag: null as never,
      message: 'INCIDENT INVOLVING CARS 77 (BOT) AND 18 (STR) NOTED - STARTING PROCEDURE INFRINGEMENT - OUT OF POSITION AT SAFETY CAR LINE',
    }))).toBeNull();
  });

  it('does not treat VSC infringement notices as VSC deployment', () => {
    expect(parseRaceControlMessageStatus(raceControl({
      category: 'Other',
      flag: null as never,
      message: 'INCIDENT INVOLVING CAR 5 (BOR) NOTED - VSC INFRINGEMENT',
    }))).toBeNull();
  });

  it('accepts OpenF1-style VSC DEPLOYED messages from the SafetyCar category', () => {
    expect(parseRaceControlMessageStatus(raceControl({
      category: 'SafetyCar',
      flag: null as never,
      message: 'VSC DEPLOYED',
    }))).toBe('VSC');
  });

  it('accepts OpenF1-style SAFETY CAR DEPLOYED messages from the SafetyCar category', () => {
    expect(parseRaceControlMessageStatus(raceControl({
      category: 'SafetyCar',
      flag: null as never,
      message: 'SAFETY CAR DEPLOYED',
    }))).toBe('SC');
  });

  it('keeps localized sector yellows through Canadian GP-style lap 13-14 sequence', () => {
    const sectors = new Set<number>();
    const apply = (overrides: Partial<OpenF1RaceControl>) => {
      const action = classifySectorFlag(raceControl(overrides));
      if (action.kind === 'set') sectors.add(action.sector);
      if (action.kind === 'clear') sectors.delete(action.sector);
      if (action.kind === 'clearAll') sectors.clear();
      return action;
    };

    apply({
      date: '2026-05-24T20:25:42+00:00',
      category: 'Flag',
      flag: 'YELLOW',
      scope: 'Sector',
      sector: 11,
      message: 'YELLOW IN TRACK SECTOR 11',
    });
    apply({
      date: '2026-05-24T20:25:50+00:00',
      category: 'Flag',
      flag: 'YELLOW',
      scope: 'Sector',
      sector: 12,
      message: 'YELLOW IN TRACK SECTOR 12',
    });
    expect([...sectors].sort()).toEqual([11, 12]);

    apply({
      date: '2026-05-24T20:25:43+00:00',
      category: 'Other',
      flag: null as never,
      message: 'FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 27 (HUL) - SPEEDING IN THE PIT LANE',
    });
    expect([...sectors].sort()).toEqual([11, 12]);

    apply({
      date: '2026-05-24T20:25:58+00:00',
      category: 'Flag',
      flag: 'CLEAR',
      scope: 'Sector',
      sector: 12,
      message: 'CLEAR IN TRACK SECTOR 12',
    });
    expect([...sectors]).toEqual([11]);

    apply({
      date: '2026-05-24T20:27:45+00:00',
      category: 'Flag',
      flag: 'CLEAR',
      scope: 'Sector',
      sector: 11,
      message: 'CLEAR IN TRACK SECTOR 11',
    });
    expect([...sectors]).toEqual([]);
  });
});
