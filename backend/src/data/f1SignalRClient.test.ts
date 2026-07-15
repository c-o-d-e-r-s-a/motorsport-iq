import { F1SignalRClient } from './f1SignalRClient';
import type { TrackStatus } from '../types';

describe('F1SignalRClient track status parsing', () => {
  it('does not promote local race-control yellow messages to global track status', () => {
    const statuses: TrackStatus[] = [];
    const client = new F1SignalRClient({
      onTrackStatusChange: (status) => statuses.push(status),
    });

    (client as unknown as { handleRaceControlMessages(data: unknown): void }).handleRaceControlMessages({
      Messages: {
        '1': {
          Utc: '2026-06-14T18:00:00Z',
          Message: 'Yellow flag in sector 2',
        },
      },
    });

    expect(statuses).toEqual([]);
  });

  it('still applies race-control safety car and track-clear messages', () => {
    const statuses: TrackStatus[] = [];
    const client = new F1SignalRClient({
      onTrackStatusChange: (status) => statuses.push(status),
    });
    const testClient = client as unknown as { handleRaceControlMessages(data: unknown): void };

    testClient.handleRaceControlMessages({
      Messages: {
        '1': {
          Utc: '2026-06-14T18:00:00Z',
          Message: 'Safety Car deployed',
        },
      },
    });
    testClient.handleRaceControlMessages({
      Messages: {
        '2': {
          Utc: '2026-06-14T18:01:00Z',
          Message: 'Track clear',
        },
      },
    });

    expect(statuses).toEqual(['SC', 'GREEN']);
  });

  it('ignores a stale, out-of-order race-control message that would regress the flag', () => {
    const statuses: TrackStatus[] = [];
    const client = new F1SignalRClient({
      onTrackStatusChange: (status) => statuses.push(status),
    });
    const testClient = client as unknown as { handleRaceControlMessages(data: unknown): void };

    // Global yellow, then a newer track-clear (green).
    testClient.handleRaceControlMessages({
      Messages: { '1': { Utc: '2026-06-14T18:00:00Z', Message: 'Yellow flag' } },
    });
    testClient.handleRaceControlMessages({
      Messages: { '2': { Utc: '2026-06-14T18:05:00Z', Message: 'Track clear' } },
    });
    // A delayed re-delivery of the OLD yellow must not flip the track back.
    testClient.handleRaceControlMessages({
      Messages: { '1': { Utc: '2026-06-14T18:00:00Z', Message: 'Yellow flag' } },
    });

    expect(statuses).toEqual(['YELLOW', 'GREEN']);
  });

  it('ignores live timing status code 2 (yellow) from the TrackStatus topic', () => {
    const statuses: TrackStatus[] = [];
    const client = new F1SignalRClient({
      onTrackStatusChange: (status) => statuses.push(status),
    });
    const testClient = client as unknown as { handleTrackStatus(data: unknown): void };

    testClient.handleTrackStatus({ Status: '2', Message: 'Yellow flag' });

    expect(statuses).toEqual([]);
  });
});

describe('F1SignalRClient position parsing', () => {
  it('does not treat TimingData Line as race position', () => {
    const positions: Array<{ driver_number: number; position: number }> = [];
    const client = new F1SignalRClient({
      onPositionUpdate: (updates) => positions.push(...updates),
    });

    (client as unknown as { handleTimingData(data: unknown): void }).handleTimingData({
      Lines: {
        '18': {
          Line: 1,
          GapToLeader: 'LEADER',
        },
      },
    });

    expect(positions).toEqual([]);
  });

  it('maps explicit TimingData Position fields into position updates', () => {
    const positions: Array<{ driver_number: number; position: number; source?: string }> = [];
    const client = new F1SignalRClient({
      onPositionUpdate: (updates) => positions.push(...updates),
    });

    (client as unknown as { handleTimingData(data: unknown): void }).handleTimingData({
      Lines: {
        '16': { Position: '1', GapToLeader: 'LEADER' },
        '18': { Line: 1, GapToLeader: '+2.5' },
      },
    });

    expect(positions).toEqual([
      {
        driver_number: 16,
        position: 1,
        source: 'timing_data',
        date: expect.any(String),
        meeting_key: 0,
        session_key: 0,
      },
    ]);
  });

  it('maps TopThree classification into position updates', () => {
    const positions: Array<{ driver_number: number; position: number; source?: string }> = [];
    const client = new F1SignalRClient({
      onPositionUpdate: (updates) => positions.push(...updates),
    });

    (client as unknown as { handleTopThree(data: unknown): void }).handleTopThree({
      Lines: {
        '1': { RacingNumber: '16' },
        '2': { RacingNumber: '12' },
        '3': { RacingNumber: '44' },
      },
    });

    expect(positions).toEqual([
      { driver_number: 16, position: 1, source: 'top_three', date: expect.any(String), meeting_key: 0, session_key: 0 },
      { driver_number: 12, position: 2, source: 'top_three', date: expect.any(String), meeting_key: 0, session_key: 0 },
      { driver_number: 44, position: 3, source: 'top_three', date: expect.any(String), meeting_key: 0, session_key: 0 },
    ]);
  });
});
