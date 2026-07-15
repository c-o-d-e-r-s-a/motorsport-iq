import { LapProcessingGate } from './lapProcessingGate';

describe('LapProcessingGate', () => {
  it('accepts one lifecycle evaluation per lobby and race lap', () => {
    const gate = new LapProcessingGate();

    expect(gate.claim('lobby-a', 'session-1', 12)).toBe(true);
    expect(gate.claim('lobby-a', 'session-1', 12)).toBe(false);
    expect(gate.claim('lobby-a', 'session-1', 11)).toBe(false);
    expect(gate.claim('lobby-a', 'session-1', 13)).toBe(true);
  });

  it('resets automatically for a new session and can be explicitly cleared', () => {
    const gate = new LapProcessingGate();

    expect(gate.claim('lobby-a', 'session-1', 20)).toBe(true);
    expect(gate.claim('lobby-a', 'session-2', 1)).toBe(true);
    expect(gate.size).toBe(1);

    gate.clear('lobby-a');
    expect(gate.size).toBe(0);
    expect(gate.claim('lobby-a', 'session-2', 1)).toBe(true);
  });
});
