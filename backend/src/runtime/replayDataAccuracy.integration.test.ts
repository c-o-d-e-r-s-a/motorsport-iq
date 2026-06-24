import { OpenF1Client } from '../data/openf1Client';
import { SnapshotStore } from '../data/snapshotStore';
import { applyReplayEvent, buildReplayTimeline, type ReplayEvent } from './replayTimeline';
import type {
  OpenF1Interval,
  OpenF1Lap,
  OpenF1Pit,
  OpenF1Position,
  OpenF1Stint,
  RaceSnapshot,
} from '../types';

const describeOpenF1Integration = process.env.RUN_OPENF1_INTEGRATION === '1' ? describe : describe.skip;

interface ReplayHarness {
  store: SnapshotStore;
  events: ReplayEvent[];
  available: boolean;
}

/** Reproduce the replay runtime's data pipeline for a finished session. */
async function buildReplayHarness(sessionKey: number): Promise<ReplayHarness> {
  const client = new OpenF1Client();
  client.setSession(sessionKey);
  client.setBypassLiveLock(true);

  const store = new SnapshotStore(client);
  await store.initialize(sessionKey, { sessionMode: 'replay', replaySpeed: 10 });

  const [laps, positions, intervals, pits, stints, raceControl] = await Promise.all([
    client.fetchLaps(),
    client.fetchPositions(),
    client.fetchIntervals(),
    client.fetchPits(),
    client.fetchStints(),
    client.fetchRaceControl(),
  ]);

  // When several OpenF1-backed suites run concurrently the API can rate-limit
  // and return a partial dataset. Treat any missing core dataset (or the live
  // lock) as "unavailable" and skip the assertion rather than fail spuriously —
  // the assertions are only meaningful with a complete replay snapshot.
  if (
    OpenF1Client.isLiveLocked()
    || (laps ?? []).length === 0
    || (positions ?? []).length === 0
  ) {
    console.warn('[integration] OpenF1 historical endpoints unavailable/partial. Skipping assertion.');
    return { store, events: [], available: false };
  }

  const totalLaps = (laps ?? []).reduce((maxLap, lap) => Math.max(maxLap, lap.lap_number), 0);
  store.setTotalLaps(totalLaps);
  store.processStintUpdate((stints as OpenF1Stint[]) ?? []);
  store.bootstrapAfterStintPreload();

  const events = buildReplayTimeline({
    laps: (laps as OpenF1Lap[]) ?? [],
    positions: (positions as OpenF1Position[]) ?? [],
    intervals: (intervals as OpenF1Interval[]) ?? [],
    pits: (pits as OpenF1Pit[]) ?? [],
    raceControl: raceControl ?? [],
  });

  return { store, events, available: true };
}

/** Replay events until the predicate is satisfied, returning that snapshot. */
function replayUntil(
  harness: ReplayHarness,
  predicate: (snapshot: RaceSnapshot) => boolean
): RaceSnapshot | null {
  for (const event of harness.events) {
    applyReplayEvent(harness.store, event);
    const snapshot = harness.store.getCurrentSnapshot();
    if (snapshot && predicate(snapshot)) {
      return snapshot;
    }
  }
  return harness.store.getCurrentSnapshot();
}

describeOpenF1Integration('replay data accuracy (real OpenF1)', () => {
  it('shows George Russell leading Barcelona 2026 from the start (not Verstappen)', async () => {
    const harness = await buildReplayHarness(11307);
    if (!harness.available) return;

    const snapshot = replayUntil(harness, (snap) =>
      snap.drivers.some((driver) => driver.position === 1)
    );

    expect(snapshot).not.toBeNull();
    const leader = snapshot!.drivers.find((driver) => driver.position === 1);
    expect(leader?.driverNumber).toBe(63);
  }, 45000);

  it('starts Australia 2026 on lap 1, never skipping straight to lap 2', async () => {
    const harness = await buildReplayHarness(11234);
    if (!harness.available) return;

    let firstPositiveLap: number | null = null;
    for (const event of harness.events) {
      applyReplayEvent(harness.store, event);
      const lap = harness.store.getCurrentSnapshot()?.lapNumber ?? 0;
      if (lap > 0) {
        firstPositiveLap = lap;
        break;
      }
    }

    expect(firstPositiveLap).toBe(1);
  }, 45000);

  it('starts Canada 2026 on lap 1 and shows the leader on the correct opening tyre', async () => {
    const harness = await buildReplayHarness(11291);
    if (!harness.available) return;

    let firstPositiveLap: number | null = null;
    for (const event of harness.events) {
      applyReplayEvent(harness.store, event);
      const lap = harness.store.getCurrentSnapshot()?.lapNumber ?? 0;
      if (lap > 0) {
        firstPositiveLap = lap;
        break;
      }
    }
    expect(firstPositiveLap).toBe(1);

    // Norris (#1) ran lap 1 on intermediates before pitting to slicks on lap 2.
    const lapOne = replayUntil(harness, (snap) => snap.lapNumber >= 1);
    const norris = lapOne?.drivers.find((driver) => driver.driverNumber === 1);
    expect(norris?.tyreCompound).toBe('INTERMEDIATE');
  }, 45000);
});
