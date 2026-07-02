import type {
  OpenF1Driver,
  OpenF1Interval,
  OpenF1Lap,
  OpenF1Pit,
  OpenF1Position,
  OpenF1RaceControl,
  OpenF1Stint,
} from '../types';
import { SnapshotStore } from './snapshotStore';

function createDriver(overrides: Partial<OpenF1Driver> = {}): OpenF1Driver {
  return {
    driver_number: 1,
    broadcast_name: 'VER',
    full_name: 'Max Verstappen',
    name_acronym: 'VER',
    team_name: 'Red Bull',
    team_colour: '3671C6',
    first_name: 'Max',
    last_name: 'Verstappen',
    headshot_url: '',
    country_code: 'NLD',
    session_key: 1001,
    meeting_key: 2001,
    ...overrides,
  };
}

function createLap(overrides: Partial<OpenF1Lap> = {}): OpenF1Lap {
  return {
    session_key: 1001,
    meeting_key: 2001,
    driver_number: 1,
    lap_number: 1,
    lap_duration: 90,
    lap_time: null,
    is_pit_out_lap: false,
    date_start: '2025-09-01T13:00:00Z',
    duration_sector_1: null,
    duration_sector_2: null,
    duration_sector_3: null,
    segments_sector_1: [],
    segments_sector_2: [],
    segments_sector_3: [],
    ...overrides,
  };
}

function createRaceControl(overrides: Partial<OpenF1RaceControl> = {}): OpenF1RaceControl {
  return {
    date: '2025-09-01T13:05:00Z',
    session_key: 1001,
    meeting_key: 2001,
    category: 'Flag',
    flag: 'YELLOW',
    scope: 'Track',
    sector: 0,
    driver_number: 0,
    message: 'YELLOW FLAG',
    lap_number: 1,
    ...overrides,
  };
}

function createPosition(overrides: Partial<OpenF1Position> = {}): OpenF1Position {
  return {
    date: '2025-09-01T13:05:00Z',
    meeting_key: 2001,
    session_key: 1001,
    driver_number: 1,
    position: 1,
    ...overrides,
  };
}

function createInterval(overrides: Partial<OpenF1Interval> = {}): OpenF1Interval {
  return {
    date: '2025-09-01T13:05:00Z',
    meeting_key: 2001,
    session_key: 1001,
    driver_number: 1,
    gap_to_leader: 0,
    interval: null,
    ...overrides,
  };
}

function createStint(overrides: Partial<OpenF1Stint> = {}): OpenF1Stint {
  return {
    date: '2025-09-01T13:05:00Z',
    session_key: 1001,
    meeting_key: 2001,
    driver_number: 1,
    stint_number: 1,
    lap_start: 1,
    lap_end: null,
    compound: 'SOFT',
    tyre_age_at_start: 0,
    ...overrides,
  };
}

function createPit(overrides: Partial<OpenF1Pit> = {}): OpenF1Pit {
  return {
    date: '2025-09-01T13:30:00Z',
    session_key: 1001,
    meeting_key: 2001,
    driver_number: 1,
    pit_duration: 2.5,
    lap_number: 26,
    number: 1,
    ...overrides,
  };
}

describe('SnapshotStore race control updates', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('rebuilds and emits the snapshot immediately when track-wide yellow is reported', async () => {
    const onSnapshotUpdate = jest.fn();
    const client = {
      getDrivers: jest.fn(async () => [createDriver()]),
    } as any;

    const store = new SnapshotStore(client, { onSnapshotUpdate });
    await store.initialize(1001, { sessionMode: 'replay', replaySpeed: 10 });
    store.processLapCompletion(createLap());

    onSnapshotUpdate.mockClear();
    store.processRaceControlUpdate([createRaceControl()]);

    expect(onSnapshotUpdate).toHaveBeenCalledTimes(1);
    expect(store.getCurrentSnapshot()?.trackStatus).toBe('GREEN');
    expect(store.getCurrentSnapshot()?.globalYellowActive).toBe(true);
  });

  it('clears display-only global yellow when a later track-clear message arrives', async () => {
    const onSnapshotUpdate = jest.fn();
    const client = {
      getDrivers: jest.fn(async () => [createDriver()]),
    } as any;

    const store = new SnapshotStore(client, { onSnapshotUpdate });
    await store.initialize(1001, { sessionMode: 'replay', replaySpeed: 10 });
    store.processLapCompletion(createLap());

    store.processRaceControlUpdate([
      createRaceControl({ date: '2025-09-01T13:05:00Z' }),
    ]);
    expect(store.getCurrentSnapshot()?.globalYellowActive).toBe(true);

    store.processRaceControlUpdate([
      createRaceControl({
        date: '2025-09-01T13:06:00Z',
        flag: 'GREEN',
        message: 'TRACK CLEAR',
      }),
    ]);
    expect(store.getCurrentSnapshot()?.globalYellowActive).toBe(false);
    expect(store.getCurrentSnapshot()?.trackStatus).toBe('GREEN');
  });

  it('prefers OpenF1 full_name over broadcast_name for displayed identity', async () => {
    const client = {
      getDrivers: jest.fn(async () => [createDriver({ full_name: 'Max Verstappen', broadcast_name: 'VER' })]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client);
    await store.initialize(1001, { sessionMode: 'replay', replaySpeed: 10 });
    store.processPositionUpdate([createPosition({ position: 1 })]);
    store.processIntervalUpdate([createInterval()]);
    store.processStintUpdate([createStint()]);
    store.processLapCompletion(createLap());

    expect(store.getCurrentSnapshot()?.drivers[0]?.name).toBe('Max Verstappen');
    expect(store.getCurrentSnapshot()?.drivers[0]?.nameSource).toBe('full_name');
  });

  it('keeps newest telemetry records by timestamp for position, interval, and stint', async () => {
    const client = {
      getDrivers: jest.fn(async () => [createDriver()]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client);
    await store.initialize(1001, { sessionMode: 'replay', replaySpeed: 10 });

    store.processPositionUpdate([
      createPosition({ date: '2025-09-01T13:06:00Z', position: 2 }),
      createPosition({ date: '2025-09-01T13:05:00Z', position: 5 }),
    ]);
    store.processIntervalUpdate([
      createInterval({ date: '2025-09-01T13:06:00Z', gap_to_leader: 1.2, interval: 0.8 }),
      createInterval({ date: '2025-09-01T13:05:00Z', gap_to_leader: 3.4, interval: 2.1 }),
    ]);
    store.processStintUpdate([
      createStint({ date: '2025-09-01T13:06:00Z', compound: 'MEDIUM', stint_number: 2 }),
      createStint({ date: '2025-09-01T13:05:00Z', compound: 'SOFT', stint_number: 1 }),
    ]);

    store.processLapCompletion(createLap({ lap_number: 2 }));
    const leader = store.getCurrentSnapshot()?.drivers[0];

    expect(leader?.position).toBe(2);
    expect(leader?.gap).toBe(1.2);
    expect(leader?.interval).toBe(0.8);
    expect(leader?.tyreCompound).toBe('MEDIUM');
  });

  it('selects the opening stint at race start even when future stints are already loaded', async () => {
    const client = {
      getDrivers: jest.fn(async () => [createDriver()]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client);
    await store.initialize(1001, { sessionMode: 'replay', replaySpeed: 10 });

    store.processStintUpdate([
      createStint({ stint_number: 1, lap_start: 1, lap_end: 19, compound: 'SOFT' }),
      createStint({ stint_number: 2, lap_start: 20, lap_end: 40, compound: 'MEDIUM' }),
    ]);
    store.processLapCompletion(createLap({ lap_number: 1, date_start: '2025-09-01T13:00:00Z' }));

    const leader = store.getCurrentSnapshot()?.drivers[0];
    expect(leader?.stintNumber).toBe(1);
    expect(leader?.tyreCompound).toBe('SOFT');
    expect(store.getCurrentSnapshot()?.leaderLapStartTime).toBe('2025-09-01T13:00:00Z');
  });

  it('updates tyre compound by lap window while session stint stays 1 until a pit stop', async () => {
    const client = {
      getDrivers: jest.fn(async () => [createDriver()]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client);
    await store.initialize(1001, { sessionMode: 'replay', replaySpeed: 10 });

    store.processStintUpdate([
      createStint({ stint_number: 1, lap_start: 1, lap_end: 19, compound: 'SOFT' }),
      createStint({ stint_number: 2, lap_start: 20, lap_end: 40, compound: 'MEDIUM' }),
    ]);

    store.processLapCompletion(createLap({ lap_number: 18 }));
    expect(store.getCurrentSnapshot()?.drivers[0]?.stintNumber).toBe(1);

    store.processLapCompletion(createLap({ lap_number: 19 }));
    expect(store.getCurrentSnapshot()?.drivers[0]?.stintNumber).toBe(1);
    expect(store.getCurrentSnapshot()?.drivers[0]?.tyreCompound).toBe('MEDIUM');
  });

  it('includes prior-session tyre age when stint starts on used tyres', async () => {
    const client = {
      getDrivers: jest.fn(async () => [createDriver()]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client);
    await store.initialize(1001, { sessionMode: 'replay', replaySpeed: 10 });

    store.processStintUpdate([
      createStint({ stint_number: 1, lap_start: 1, lap_end: null, compound: 'MEDIUM', tyre_age_at_start: 8 }),
    ]);
    store.processLapCompletion(createLap({ lap_number: 3 }));

    const leader = store.getCurrentSnapshot()?.drivers[0];
    expect(leader?.tyreAge).toBe(11);
    expect(leader?.tyreAge).toBeGreaterThan(store.getCurrentSnapshot()?.lapNumber ?? 0);
  });

  it('marks a stalled car retired (lap-stall) while the leader keeps running', async () => {
    const client = {
      getDrivers: jest.fn(async () => [
        createDriver({ driver_number: 1 }),
        createDriver({ driver_number: 2, full_name: 'Lance Stroll', broadcast_name: 'STR' }),
      ]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client);
    await store.initialize(1001, { sessionMode: 'replay', replaySpeed: 10 });

    store.processPositionUpdate([
      createPosition({ driver_number: 1, position: 1 }),
      createPosition({ driver_number: 2, position: 2 }),
    ]);

    // Both cars complete laps 1-3.
    for (let lap = 1; lap <= 3; lap++) {
      store.processLapCompletion(createLap({ driver_number: 1, lap_number: lap }));
      store.processLapCompletion(createLap({ driver_number: 2, lap_number: lap }));
    }

    // Driver 2 crashes out; only the leader keeps completing laps. After the
    // stale-lap threshold the stalled car is marked retired.
    for (let lap = 4; lap <= 8; lap++) {
      store.processLapCompletion(createLap({ driver_number: 1, lap_number: lap }));
    }

    const snapshot = store.getCurrentSnapshot();
    const stalled = snapshot?.drivers.find((d) => d.driverNumber === 2);
    const leader = snapshot?.drivers.find((d) => d.driverNumber === 1);
    expect(stalled?.retired).toBe(true);
    expect(leader?.retired).toBe(false);
  });

  it('does not retire a running car when the displayed lap jumps without lap completions', async () => {
    const client = {
      getDrivers: jest.fn(async () => [createDriver({ driver_number: 1 })]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client);
    await store.initialize(1001, { sessionMode: 'replay', replaySpeed: 10 });

    store.processPositionUpdate([createPosition({ driver_number: 1, position: 1 })]);
    store.processLapCompletion(createLap({ driver_number: 1, lap_number: 1 }));

    // Lap counter jumps far ahead (sync / sparse telemetry) with no new lap
    // completions — the leader is still running and must NOT be marked retired.
    store.syncLapNumber(20);

    const leader = store.getCurrentSnapshot()?.drivers.find((d) => d.driverNumber === 1);
    expect(leader?.retired).toBe(false);
  });

  it('uses F1 current-lap numbering in replay and live mode', async () => {
    const client = {
      getDrivers: jest.fn(async () => [createDriver()]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const replayStore = new SnapshotStore(client);
    await replayStore.initialize(1001, { sessionMode: 'replay', replaySpeed: 1 });
    replayStore.processLapCompletion(createLap({ lap_number: 14 }));
    expect(replayStore.getCurrentSnapshot()?.lapNumber).toBe(15);
    replayStore.syncLapNumber(99);
    expect(replayStore.getCurrentSnapshot()?.lapNumber).toBe(15);

    const liveStore = new SnapshotStore(client);
    await liveStore.initialize(1002, { sessionMode: 'live', skipDriverPreload: true });
    liveStore.processLapCompletion(createLap({ lap_number: 14 }));
    expect(liveStore.getCurrentSnapshot()?.lapNumber).toBe(15);

    const simLiveStore = new SnapshotStore(client);
    await simLiveStore.initialize(1003, {
      sessionMode: 'live',
      skipDriverPreload: true,
      openF1LapNumbering: true,
    });
    simLiveStore.processLapCompletion(createLap({ lap_number: 1 }));
    expect(simLiveStore.getCurrentSnapshot()?.lapNumber).toBe(1);
  });

  it('fires onLapComplete only when the displayed lap advances and keeps lap-boundary snapshots', async () => {
    const onLapComplete = jest.fn();
    const client = {
      getDrivers: jest.fn(async () => [createDriver()]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client, { onLapComplete });
    await store.initialize(1001, { sessionMode: 'replay', replaySpeed: 1 });
    store.processPositionUpdate([createPosition({ position: 1 })]);
    store.processIntervalUpdate([createInterval({ interval: 1.0 })]);

    store.processLapCompletion(createLap({ lap_number: 1 }));
    expect(onLapComplete).toHaveBeenCalledTimes(1);
    expect(store.getCurrentSnapshot()?.lapNumber).toBe(2);
    expect(store.getPreviousLapSnapshot()?.lapNumber).toBe(1);

    onLapComplete.mockClear();
    store.processLapCompletion(createLap({ lap_number: 1, driver_number: 2 }));
    expect(onLapComplete).not.toHaveBeenCalled();

    store.processIntervalUpdate([createInterval({ interval: 0.6 })]);
    store.processLapCompletion(createLap({ lap_number: 2 }));
    expect(onLapComplete).toHaveBeenCalledTimes(1);
    expect(store.getPreviousLapSnapshot()?.lapNumber).toBe(2);
    expect(store.getCurrentSnapshot()?.lapNumber).toBe(3);
  });

  it('live mode emits onLapComplete for every lap completion and on syncLapNumber advance', async () => {
    const onLapComplete = jest.fn();
    const client = {
      getDrivers: jest.fn(async () => [createDriver()]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client, { onLapComplete });
    await store.initialize(1002, { sessionMode: 'live', skipDriverPreload: true });
    store.processPositionUpdate([createPosition({ position: 1 })]);

    store.processLapCompletion(createLap({ lap_number: 1 }));
    expect(onLapComplete).toHaveBeenCalledTimes(1);

    onLapComplete.mockClear();
    store.processLapCompletion(createLap({ lap_number: 1, driver_number: 2 }));
    expect(onLapComplete).toHaveBeenCalledTimes(1);

    onLapComplete.mockClear();
    store.syncLapNumber(5);
    expect(onLapComplete).toHaveBeenCalledTimes(1);
    expect(store.getCurrentSnapshot()?.lapNumber).toBe(5);
  });

  it('emits HUD snapshot updates on telemetry changes with a 1s throttle in live mode', async () => {
    const onSnapshotUpdate = jest.fn();
    const client = {
      getDrivers: jest.fn(async () => [createDriver()]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client, { onSnapshotUpdate });
    await store.initialize(1001, { sessionMode: 'live', skipDriverPreload: true });
    store.processLapCompletion(createLap());
    onSnapshotUpdate.mockClear();

    store.processPositionUpdate([createPosition({ date: '2025-09-01T13:06:00Z', position: 2 })]);
    expect(onSnapshotUpdate).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1_000);
    expect(onSnapshotUpdate).toHaveBeenCalledTimes(1);
  });

  it('keeps the previous known leader when incoming position telemetry is 0', async () => {
    const client = {
      getDrivers: jest.fn(async () => [
        createDriver({ driver_number: 1, full_name: 'Driver One', broadcast_name: 'ONE' }),
        createDriver({ driver_number: 2, full_name: 'Driver Two', broadcast_name: 'TWO' }),
      ]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client);
    await store.initialize(1001, { sessionMode: 'replay', replaySpeed: 10 });

    store.processPositionUpdate([
      createPosition({ driver_number: 1, position: 2, date: '2025-09-01T13:05:00Z' }),
      createPosition({ driver_number: 2, position: 1, date: '2025-09-01T13:05:00Z' }),
    ]);
    store.processLapCompletion(createLap({ driver_number: 1, lap_number: 1 }));

    store.processPositionUpdate([
      createPosition({ driver_number: 1, position: 0, date: '2025-09-01T13:06:00Z' }),
      createPosition({ driver_number: 2, position: 0, date: '2025-09-01T13:06:00Z' }),
    ]);
    await jest.advanceTimersByTimeAsync(1_000);

    expect(store.getCurrentSnapshot()?.drivers[0]?.name).toBe('Driver Two');
  });

  it('preserves compound when a stint update arrives without compound data', async () => {
    const client = {
      getDrivers: jest.fn(async () => [createDriver()]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client);
    await store.initialize(1001, { sessionMode: 'replay', replaySpeed: 10 });

    store.processStintUpdate([
      createStint({ stint_number: 1, lap_start: 1, lap_end: null, compound: 'SOFT' }),
    ]);
    store.processStintUpdate([
      createStint({
        date: '2025-09-01T13:06:00Z',
        stint_number: 1,
        lap_start: 1,
        lap_end: 19,
        compound: null,
      }),
    ]);
    store.processLapCompletion(createLap({ lap_number: 10 }));

    expect(store.getCurrentSnapshot()?.drivers[0]?.tyreCompound).toBe('SOFT');
  });

  it('keeps live tyre age reset after a pit when a stale stint update carries old age', async () => {
    const client = {
      getDrivers: jest.fn(async () => [createDriver()]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client);
    await store.initialize(1001, { sessionMode: 'live' });

    store.processPositionUpdate([createPosition({ position: 1 })]);
    store.processIntervalUpdate([createInterval()]);
    store.processStintUpdate([
      createStint({ stint_number: 1, lap_start: 1, lap_end: null, compound: 'SOFT', tyre_age_at_start: 0 }),
    ]);
    store.processLapCompletion(createLap({ lap_number: 25 }));

    store.processPitUpdate([createPit({ lap_number: 26, number: 1 })]);
    store.processStintUpdate([
      createStint({
        date: '2025-09-01T13:31:00Z',
        session_key: 0,
        meeting_key: 0,
        stint_number: 2,
        lap_start: 26,
        lap_end: null,
        compound: 'MEDIUM',
        tyre_age_at_start: 26,
      }),
    ]);
    store.processLapCompletion(createLap({ lap_number: 26, date_start: '2025-09-01T13:32:00Z' }));

    const leader = store.getCurrentSnapshot()?.drivers[0];
    expect(leader?.stintNumber).toBe(2);
    expect(leader?.tyreCompound).toBe('MEDIUM');
    expect(leader?.tyreAge).toBe(1);
  });

  it('resets tyre age to 0 on the pit lap (age 17 → 0 when a fresh stint starts)', async () => {
    const client = {
      getDrivers: jest.fn(async () => [createDriver()]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client);
    await store.initialize(1001, { sessionMode: 'replay', replaySpeed: 10 });

    store.processStintUpdate([
      createStint({ stint_number: 1, lap_start: 1, lap_end: null, compound: 'MEDIUM', tyre_age_at_start: 0 }),
    ]);
    // Running lap 18 on the opening stint → 17 laps of wear.
    store.processLapCompletion(createLap({ lap_number: 17 }));
    expect(store.getCurrentSnapshot()?.lapNumber).toBe(18);
    expect(store.getCurrentSnapshot()?.drivers[0]?.tyreAge).toBe(17);

    // Pit on lap 18 and bolt on a fresh set.
    store.processPitUpdate([createPit({ lap_number: 18, number: 1 })]);
    store.processStintUpdate([
      createStint({ stint_number: 2, lap_start: 18, lap_end: null, compound: 'HARD', tyre_age_at_start: 0 }),
    ]);

    const leader = store.getCurrentSnapshot()?.drivers[0];
    expect(leader?.stintNumber).toBe(2);
    expect(leader?.tyreCompound).toBe('HARD');
    expect(leader?.tyreAge).toBe(0);
  });

  it('falls back to the previous stint compound after a pit stop with missing compound', async () => {
    const client = {
      getDrivers: jest.fn(async () => [createDriver()]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client);
    await store.initialize(1001, { sessionMode: 'replay', replaySpeed: 10 });

    store.processStintUpdate([
      createStint({ stint_number: 1, lap_start: 1, lap_end: 19, compound: 'SOFT' }),
      createStint({ stint_number: 2, lap_start: 20, lap_end: null, compound: null }),
    ]);
    store.processLapCompletion(createLap({ lap_number: 22 }));

    expect(store.getCurrentSnapshot()?.drivers[0]?.tyreCompound).toBe('SOFT');
  });

  it('bootstraps leader compound before the first lap completes', async () => {
    const client = {
      getDrivers: jest.fn(async () => [createDriver()]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client);
    await store.initialize(1001, { sessionMode: 'replay', replaySpeed: 10 });

    store.processStintUpdate([
      createStint({ stint_number: 1, lap_start: 1, lap_end: null, compound: 'MEDIUM' }),
    ]);
    store.processPositionUpdate([createPosition({ position: 1 })]);
    store.bootstrapAfterStintPreload();

    expect(store.getCurrentSnapshot()?.drivers[0]?.tyreCompound).toBe('MEDIUM');
    expect(store.getCurrentSnapshot()?.lapNumber).toBe(1);
  });

  it('starts at lap 1 when live telemetry arrives before the first lap completes', async () => {
    const client = {
      getDrivers: jest.fn(async () => [createDriver()]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client);
    await store.initialize(1002, { sessionMode: 'live', skipDriverPreload: true });
    store.processPositionUpdate([createPosition({ position: 1 })]);
    jest.runOnlyPendingTimers();

    expect(store.getCurrentSnapshot()?.lapNumber).toBe(1);
  });

  it('tracks localized sector yellows for display without changing track status', async () => {
    const client = {
      getDrivers: jest.fn(async () => [createDriver()]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client);
    await store.initialize(1001, { sessionMode: 'replay', replaySpeed: 10 });
    store.processPositionUpdate([createPosition({ position: 1 })]);
    store.processLapCompletion(createLap({ lap_number: 9 }));

    store.processRaceControlUpdate([
      createRaceControl({ flag: 'DOUBLE YELLOW', scope: 'Sector', sector: 6, message: 'DOUBLE YELLOW IN TRACK SECTOR 6' }),
    ]);
    expect(store.getCurrentSnapshot()?.trackStatus).toBe('GREEN');
    expect(store.getCurrentSnapshot()?.localYellowSectors).toEqual([6]);

    store.processRaceControlUpdate([
      createRaceControl({ flag: 'YELLOW', scope: 'Sector', sector: 7, message: 'YELLOW IN TRACK SECTOR 7' }),
    ]);
    expect(store.getCurrentSnapshot()?.localYellowSectors).toEqual([6, 7]);

    store.processRaceControlUpdate([
      createRaceControl({ flag: 'CLEAR', scope: 'Sector', sector: 6, message: 'CLEAR IN TRACK SECTOR 6' }),
    ]);
    expect(store.getCurrentSnapshot()?.localYellowSectors).toEqual([7]);

    // A global green/track-clear wipes every localized sector yellow.
    store.processRaceControlUpdate([
      createRaceControl({ flag: 'GREEN', scope: 'Track', sector: 0, message: 'TRACK CLEAR' }),
    ]);
    expect(store.getCurrentSnapshot()?.localYellowSectors).toEqual([]);
    expect(store.getCurrentSnapshot()?.trackStatus).toBe('GREEN');
  });

  it('keeps sector 11 yellow through replay lap 14 until an explicit sector clear', async () => {
    const client = {
      getDrivers: jest.fn(async () => [createDriver()]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client);
    await store.initialize(11291, { sessionMode: 'replay', replaySpeed: 10 });
    store.processPositionUpdate([createPosition({ position: 1 })]);
    store.processLapCompletion(createLap({ lap_number: 12 }));

    store.processRaceControlUpdate([
      createRaceControl({
        date: '2026-05-24T20:25:42+00:00',
        category: 'Flag',
        flag: 'YELLOW',
        scope: 'Sector',
        sector: 11,
        message: 'YELLOW IN TRACK SECTOR 11',
      }),
      createRaceControl({
        date: '2026-05-24T20:25:50+00:00',
        category: 'Flag',
        flag: 'YELLOW',
        scope: 'Sector',
        sector: 12,
        message: 'YELLOW IN TRACK SECTOR 12',
      }),
    ]);
    expect(store.getCurrentSnapshot()?.localYellowSectors).toEqual([11, 12]);

    store.processRaceControlUpdate([
      createRaceControl({
        date: '2026-05-24T20:25:58+00:00',
        category: 'Flag',
        flag: 'CLEAR',
        scope: 'Sector',
        sector: 12,
        message: 'CLEAR IN TRACK SECTOR 12',
      }),
    ]);
    expect(store.getCurrentSnapshot()?.localYellowSectors).toEqual([11]);

    store.processLapCompletion(createLap({ lap_number: 13 }));
    expect(store.getCurrentSnapshot()?.lapNumber).toBe(14);
    expect(store.getCurrentSnapshot()?.localYellowSectors).toEqual([11]);

    store.processRaceControlUpdate([
      createRaceControl({
        date: '2026-05-24T20:27:45+00:00',
        category: 'Flag',
        flag: 'CLEAR',
        scope: 'Sector',
        sector: 11,
        message: 'CLEAR IN TRACK SECTOR 11',
      }),
    ]);
    expect(store.getCurrentSnapshot()?.localYellowSectors).toEqual([]);
  });

  it('clears localized sector yellows when a global neutralization (SC) is shown', async () => {
    const client = {
      getDrivers: jest.fn(async () => [createDriver()]),
      parseTrackStatus: jest.fn((messages: any[]) =>
        messages.some((m) => String(m.message).includes('SAFETY CAR')) ? ('SC' as const) : ('GREEN' as const)
      ),
    } as any;

    const store = new SnapshotStore(client);
    await store.initialize(1001, { sessionMode: 'replay', replaySpeed: 10 });
    store.processPositionUpdate([createPosition({ position: 1 })]);
    store.processLapCompletion(createLap({ lap_number: 9 }));

    store.processRaceControlUpdate([
      createRaceControl({ flag: 'YELLOW', scope: 'Sector', sector: 4, message: 'YELLOW IN TRACK SECTOR 4' }),
    ]);
    expect(store.getCurrentSnapshot()?.localYellowSectors).toEqual([4]);

    store.processRaceControlUpdate([
      createRaceControl({ category: 'SafetyCar', flag: null as never, scope: 'Track', sector: 0, message: 'SAFETY CAR DEPLOYED' }),
    ]);
    expect(store.getCurrentSnapshot()?.trackStatus).toBe('SC');
    expect(store.getCurrentSnapshot()?.localYellowSectors).toEqual([]);
  });

  it('starts at lap 1 when SESSION STARTED race control is received', async () => {
    const onSnapshotUpdate = jest.fn();
    const client = {
      getDrivers: jest.fn(async () => [createDriver()]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client, { onSnapshotUpdate });
    await store.initialize(1001, { sessionMode: 'replay', replaySpeed: 10 });

    store.processRaceControlUpdate([
      createRaceControl({
        date: '2025-09-01T13:00:00Z',
        category: 'SessionStatus',
        flag: 'GREEN',
        scope: 'Track',
        message: 'SESSION STARTED',
      }),
    ]);

    expect(store.getCurrentSnapshot()?.lapNumber).toBe(1);
  });

  it('opens a full race on the correct opening compound', async () => {
    const client = {
      getDrivers: jest.fn(async () => [createDriver({ driver_number: 63, full_name: 'George RUSSELL' })]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client);
    await store.initialize(1001, { sessionMode: 'replay', replaySpeed: 10 });

    store.processStintUpdate([
      createStint({ driver_number: 63, stint_number: 1, lap_start: 1, lap_end: 10, compound: 'MEDIUM' }),
      createStint({ driver_number: 63, stint_number: 2, lap_start: 11, lap_end: 56, compound: 'HARD' }),
    ]);
    store.processPositionUpdate([createPosition({ driver_number: 63, position: 1 })]);
    jest.runOnlyPendingTimers();

    const leader = store.getCurrentSnapshot()?.drivers.find((d) => d.driverNumber === 63);
    expect(leader?.stintNumber).toBe(1);
    expect(leader?.tyreCompound).toBe('MEDIUM');
  });

  it('keeps stint and compound locked after a live pit when stale stint data arrives on lap 1', async () => {
    const client = {
      getDrivers: jest.fn(async () => [createDriver()]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client);
    await store.initialize(1001, { sessionMode: 'live', skipDriverPreload: true });

    store.processPositionUpdate([createPosition({ position: 1 })]);
    store.processStintUpdate([
      createStint({ stint_number: 1, lap_start: 1, lap_end: null, compound: 'SOFT', tyre_age_at_start: 0 }),
    ]);
    store.processLapCompletion(createLap({ lap_number: 25 }));

    store.processPitUpdate([createPit({ lap_number: 26, number: 1 })]);
    store.processStintUpdate([
      createStint({
        stint_number: 2,
        lap_start: 26,
        lap_end: null,
        compound: 'MEDIUM',
        tyre_age_at_start: 0,
      }),
    ]);

    store.processStintUpdate([
      createStint({ stint_number: 1, lap_start: 1, lap_end: 25, compound: 'SOFT', tyre_age_at_start: 0 }),
    ]);
    store.processLapCompletion(createLap({ lap_number: 26, date_start: '2025-09-01T13:32:00Z' }));

    const leader = store.getCurrentSnapshot()?.drivers[0];
    expect(leader?.stintNumber).toBe(2);
    expect(leader?.tyreCompound).toBe('MEDIUM');
    expect(leader?.tyreAge).toBe(1);
  });

  it('synthesizes the missing opening MEDIUM stint for China 2026 sprint post-pit-only OpenF1 data', async () => {
    const client = {
      getDrivers: jest.fn(async () => [createDriver({ driver_number: 63, full_name: 'George RUSSELL' })]),
      parseTrackStatus: jest.fn(() => 'GREEN' as const),
    } as any;

    const store = new SnapshotStore(client);
    await store.initialize(11240, { sessionMode: 'replay', replaySpeed: 10 });

    // OpenF1 only ships Russell's post-SC SOFT stint (lap 14+) for session 11240.
    store.processStintUpdate([
      createStint({
        driver_number: 63,
        stint_number: 2,
        lap_start: 14,
        lap_end: 19,
        compound: 'SOFT',
        tyre_age_at_start: 0,
      }),
    ]);
    store.processPositionUpdate([createPosition({ driver_number: 63, position: 1 })]);
    jest.runOnlyPendingTimers();

    const atLapOne = store.getCurrentSnapshot()?.drivers.find((d) => d.driverNumber === 63);
    expect(atLapOne?.stintNumber).toBe(1);
    expect(atLapOne?.tyreCompound).toBe('MEDIUM');
    expect(atLapOne?.tyreAge).toBe(0);

    store.processPitUpdate([createPit({ driver_number: 63, lap_number: 13, number: 1 })]);
    store.processLapCompletion(createLap({ driver_number: 63, lap_number: 14 }));

    const afterPit = store.getCurrentSnapshot()?.drivers.find((d) => d.driverNumber === 63);
    expect(afterPit?.stintNumber).toBe(2);
    expect(afterPit?.tyreCompound).toBe('SOFT');
    expect(afterPit?.tyreAge).toBe(1);
  });
});
