import { OpenF1Client } from '../data/openf1Client';
import { DEFAULT_SIMULATION_SESSION_KEY, getCalendarSession } from '../data/f1Calendar';
import { SnapshotStore } from '../data/snapshotStore';
import { buildReplayTimeline } from '../runtime/replayTimeline';
import { selectQuestion } from '../engine/questionEngine';
import type { OpenF1Interval, OpenF1Lap, OpenF1Pit, OpenF1Position, OpenF1RaceControl } from '../types';

const describeOpenF1Integration = process.env.RUN_OPENF1_INTEGRATION === '1' ? describe : describe.skip;

describeOpenF1Integration('Canadian GP simulation question selection', () => {
  it('can select at least one question after lap 3 using live session semantics', async () => {
    const lookupClient = new OpenF1Client();
    const resolvedSession = getCalendarSession(DEFAULT_SIMULATION_SESSION_KEY)
      ?? await lookupClient.getSession(DEFAULT_SIMULATION_SESSION_KEY);
    expect(resolvedSession).not.toBeNull();
    const client = new OpenF1Client();
    client.setSession(resolvedSession!.session_key);

    const store = new SnapshotStore(client);
    await store.initialize(resolvedSession!.session_key, {      sessionMode: 'live',
      replaySpeed: null,
      skipDriverPreload: false,
      openF1LapNumbering: true,
    });
    store.setTotalLaps(70);

    const [laps, positions, intervals, pits, raceControl] = await Promise.all([
      client.fetchLaps(),
      client.fetchPositions(),
      client.fetchIntervals(),
      client.fetchPits(),
      client.fetchRaceControl(),
    ]);

    if (OpenF1Client.isLiveLocked() || (laps ?? []).length === 0) {
      console.warn('[integration] OpenF1 historical endpoints unavailable. Skipping assertion.');
      return;
    }

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

          const question = selectQuestion(snapshot, previousSnapshot, 'sim-lobby', null, 0);
          if (question) {
            foundQuestion = true;
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
