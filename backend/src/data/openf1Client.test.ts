import { OpenF1Client } from './openf1Client';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('OpenF1Client live lock', () => {
  afterEach(() => {
    OpenF1Client.resetLiveLock();
  });

  it('allows completed replay clients to bypass a previous live-session lock', async () => {
    OpenF1Client.resetLiveLock();

    const lockedFetch = jest.fn(async () => new Response('Live F1 session in progress', { status: 401 }));
    const liveClient = new OpenF1Client({}, lockedFetch as unknown as typeof fetch);
    liveClient.setSession(11307);

    await expect(liveClient.fetchLaps()).resolves.toBeNull();
    expect(OpenF1Client.isLiveLocked()).toBe(true);

    const replayFetch = jest.fn(async () => jsonResponse([
      {
        session_key: 11307,
        meeting_key: 1287,
        driver_number: 1,
        lap_number: 1,
        lap_duration: 90,
        lap_time: '1:30.000',
        is_pit_out_lap: false,
        date_start: '2026-06-14T13:00:00Z',
        duration_sector_1: null,
        duration_sector_2: null,
        duration_sector_3: null,
        segments_sector_1: [],
        segments_sector_2: [],
        segments_sector_3: [],
      },
    ]));
    const replayClient = new OpenF1Client({}, replayFetch as unknown as typeof fetch);
    replayClient.setSession(11307);
    replayClient.setBypassLiveLock(true);

    const laps = await replayClient.fetchLaps();
    expect(laps).toHaveLength(1);
    expect(replayFetch).toHaveBeenCalledTimes(1);
  });

  it('checks replay telemetry even when live lock is set', async () => {
    OpenF1Client.resetLiveLock();

    const lockedFetch = jest.fn(async () => new Response('Live F1 session in progress', { status: 401 }));
    const liveClient = new OpenF1Client({}, lockedFetch as unknown as typeof fetch);
    liveClient.setSession(11307);
    await liveClient.fetchLaps();
    expect(OpenF1Client.isLiveLocked()).toBe(true);

    const telemetryFetch = jest.fn(async () => jsonResponse([{ lap_number: 1 }]));
    const lookupClient = new OpenF1Client({}, telemetryFetch as unknown as typeof fetch);

    await expect(lookupClient.sessionHasTelemetry(11307)).resolves.toBe(true);
    expect(telemetryFetch).toHaveBeenCalledTimes(1);
  });
});
