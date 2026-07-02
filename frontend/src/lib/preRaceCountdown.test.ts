import { describe, expect, it } from '@jest/globals';
import { formatRaceStartCountdown } from './preRaceCountdown';

describe('formatRaceStartCountdown', () => {
  it('formats full minutes and seconds', () => {
    expect(formatRaceStartCountdown(45 * 60 * 1000)).toBe('45:00');
    expect(formatRaceStartCountdown(5 * 60 * 1000 + 30 * 1000)).toBe('5:30');
    expect(formatRaceStartCountdown(59 * 1000)).toBe('0:59');
  });

  it('never goes below zero', () => {
    expect(formatRaceStartCountdown(0)).toBe('0:00');
    expect(formatRaceStartCountdown(-5000)).toBe('0:00');
  });

  it('rounds partial seconds up', () => {
    expect(formatRaceStartCountdown(1001)).toBe('0:02');
  });
});
