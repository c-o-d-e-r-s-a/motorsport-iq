import {
  computeLiveBroadcastDelayMs,
  DEFAULT_LIVE_BROADCAST_DELAY_MS,
  LIVE_BROADCAST_DELAY_MS,
  scheduleDelayedLiveSnapshotEmit,
  scheduleLiveBroadcastAction,
  shouldDelayLiveBroadcast,
} from './liveBroadcastDelay';

describe('liveBroadcastDelay', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('defaults to 22s broadcast delay', () => {
    expect(LIVE_BROADCAST_DELAY_MS).toBe(DEFAULT_LIVE_BROADCAST_DELAY_MS);
    expect(DEFAULT_LIVE_BROADCAST_DELAY_MS).toBe(22_000);
  });

  it('only delays live snapshots', () => {
    expect(shouldDelayLiveBroadcast({ sessionMode: 'live' })).toBe(true);
    expect(shouldDelayLiveBroadcast({ sessionMode: 'replay' })).toBe(false);
  });

  it('computes remaining delay from snapshot timestamp', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    const delayMs = computeLiveBroadcastDelayMs({
      sessionMode: 'live',
      timestamp: new Date(now - 5_000),
    });

    expect(delayMs).toBe(LIVE_BROADCAST_DELAY_MS - 5_000);
  });

  it('schedules snapshot emits after the remaining delay', () => {
    jest.useFakeTimers();
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    scheduleDelayedLiveSnapshotEmit(
      { sessionMode: 'live', timestamp: new Date(now) },
      () => undefined
    );

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), LIVE_BROADCAST_DELAY_MS);
  });

  it('schedules lap actions with the full broadcast delay', () => {
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    scheduleLiveBroadcastAction(() => undefined);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), LIVE_BROADCAST_DELAY_MS);
  });
});
