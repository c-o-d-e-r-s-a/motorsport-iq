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
});
