import { OpenF1Client } from '../data/openf1Client';
import { SnapshotStore } from '../data/snapshotStore';
import { buildReplayTimeline } from './replayTimeline';
import { selectQuestion } from '../engine/questionEngine';
import type { OpenF1Interval, OpenF1Lap, OpenF1Pit, OpenF1Position, OpenF1RaceControl } from '../types';

const describeOpenF1Integration = process.env.RUN_OPENF1_INTEGRATION === '1' ? describe : describe.skip;

describeOpenF1Integration('historical replay question selection', () => {
  it('can select at least one question for the Melbourne 2026 race replay', async () => {
    const sessionKey = 11234;
    const client = new OpenF1Client();
    client.setSession(sessionKey);

    const store = new SnapshotStore(client);
    await store.initialize(sessionKey, { sessionMode: 'replay', replaySpeed: 10 });

    const [laps, positions, intervals, pits, raceControl] = await Promise.all([
      client.fetchLaps(),
      client.fetchPositions(),
      client.fetchIntervals(),
      client.fetchPits(),
      client.fetchRaceControl(),
    ]);

    // OpenF1 returns 401 on every data endpoint while a live F1 session is
    // in progress. This integration test depends on the real API, so when
    // that lock kicks in we skip the assertion rather than fail spuriously —
    // SignalR (covered by separate tests) is the live-window data source.
    if (
      OpenF1Client.isLiveLocked()
      || (laps ?? []).length === 0
      || (positions ?? []).length === 0
      || (intervals ?? []).length === 0
    ) {
      console.warn('[integration] OpenF1 historical endpoints unavailable/partial (live lock or rate limit). Skipping assertion.');
      return;
    }

    const totalLaps = (laps ?? []).reduce((maxLap, lap) => Math.max(maxLap, lap.lap_number), 0);
    store.setTotalLaps(totalLaps);

    const events = buildReplayTimeline({
      laps: laps ?? [],
      positions: positions ?? [],
      intervals: intervals ?? [],
      pits: pits ?? [],
      raceControl: raceControl ?? [],
    });

    let foundQuestion = false;

    for (const event of events) {
      switch (event.type) {
        case 'race_control':
          store.processRaceControlUpdate([event.data as OpenF1RaceControl]);
          break;
        case 'position':
          store.processPositionUpdate([event.data as OpenF1Position]);
          break;
        case 'interval':
          store.processIntervalUpdate([event.data as OpenF1Interval]);
          break;
        case 'pit':
          store.processPitUpdate([event.data as OpenF1Pit]);
          break;
        case 'lap': {
          store.processLapCompletion(event.data as OpenF1Lap);
          const snapshot = store.getCurrentSnapshot();
          const previousSnapshot = store.getPreviousSnapshot();

          if (!snapshot || snapshot.lapNumber < 4) {
            break;
          }

          const question = selectQuestion(snapshot, previousSnapshot, 'integration-lobby', null, 0);
          if (question) {
            foundQuestion = true;
            break;
          }
          break;
        }
      }

      if (foundQuestion) {
        break;
      }
    }

    expect(foundQuestion).toBe(true);
  }, 30000);
});
