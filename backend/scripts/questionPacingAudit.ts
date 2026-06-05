/**
 * Replay audit: simulates lap-by-lap question selection on historical OpenF1 sessions.
 * Run: cd backend && npx ts-node scripts/questionPacingAudit.ts
 */
import 'dotenv/config';
import { OpenF1Client } from '../src/data/openf1Client';
import { SnapshotStore } from '../src/data/snapshotStore';
import { buildReplayTimeline } from '../src/runtime/replayTimeline';
import { getCalendarSession, getScheduledLaps } from '../src/data/f1Calendar';
import {
  clearCooldowns,
  MIN_QUESTIONS_PER_RACE,
  recordResolution,
  selectQuestionWithMeta,
  type RelaxationTier,
} from '../src/engine/questionEngine';
import { getQuestionById } from '../src/engine/questionBank';
import type {
  OpenF1Interval,
  OpenF1Lap,
  OpenF1Pit,
  OpenF1Position,
  OpenF1RaceControl,
  OpenF1Session,
  QuestionInstanceState,
} from '../src/types';

const PREFERRED_SPRINT_KEYS = [11286];
const PREFERRED_RACE_KEYS = [11291, 11295];

interface AuditResult {
  sessionKey: number;
  sessionName: string;
  totalLaps: number;
  questionsTriggered: number;
  tierBreakdown: Record<RelaxationTier, number>;
}

function emptyTierBreakdown(): Record<RelaxationTier, number> {
  return { strict: 0, tier1: 0, tier2: 0, tier3: 0, urgency: 0 };
}

async function resolveAuditSessions(client: OpenF1Client): Promise<OpenF1Session[]> {
  const resolved = new Map<number, OpenF1Session>();

  for (const key of [...PREFERRED_SPRINT_KEYS, ...PREFERRED_RACE_KEYS]) {
    const session = getCalendarSession(key) ?? await client.getSession(key);
    if (session) {
      resolved.set(session.session_key, session);
    }
  }

  for (const year of [2025, 2026]) {
    const sessions = await client.getSessions(year);
    if (!sessions) {
      continue;
    }

    const sprints = sessions
      .filter((session) => session.session_name === 'Sprint')
      .sort((a, b) => new Date(b.date_start).getTime() - new Date(a.date_start).getTime());
    const races = sessions
      .filter((session) => session.session_name === 'Race')
      .sort((a, b) => new Date(b.date_start).getTime() - new Date(a.date_start).getTime());

    for (const session of sprints.slice(0, 3)) {
      resolved.set(session.session_key, session);
    }
    for (const session of races.slice(0, 4)) {
      resolved.set(session.session_key, session);
    }
  }

  const all = Array.from(resolved.values());
  const sprints = all.filter((session) => session.session_name === 'Sprint');
  const races = all.filter((session) => session.session_name === 'Race');

  const selected = [...sprints.slice(0, 4), ...races.slice(0, 5)];
  if (selected.length < 5) {
    throw new Error(
      `Need at least 2 Sprint and 3 Race sessions; found ${sprints.length} Sprint, ${races.length} Race`
    );
  }

  return selected;
}

async function auditSession(session: OpenF1Session): Promise<AuditResult | null> {
  if (OpenF1Client.isLiveLocked()) {
    console.warn('[audit] OpenF1 live-locked — skipping session', session.session_key);
    return null;
  }

  const lobbyId = `audit-${session.session_key}`;
  clearCooldowns(lobbyId);

  const client = new OpenF1Client();
  client.setSession(session.session_key);
  const store = new SnapshotStore(client);

  try {
    await store.initialize(session.session_key, {
      sessionMode: 'replay',
      replaySpeed: 10,
      skipDriverPreload: false,
      openF1LapNumbering: true,
    });
  } catch (error) {
    console.warn(`[audit] Failed to initialize session ${session.session_key}:`, error);
    return null;
  }

  const scheduledLaps = getScheduledLaps(session);

  let laps;
  let positions;
  let intervals;
  let pits;
  let raceControl;

  try {
    [laps, positions, intervals, pits, raceControl] = await Promise.all([
      client.fetchLaps(),
      client.fetchPositions(),
      client.fetchIntervals(),
      client.fetchPits(),
      client.fetchRaceControl(),
    ]);
  } catch (error) {
    console.warn(`[audit] Failed to fetch replay data for session ${session.session_key}:`, error);
    return null;
  }

  if (!laps || laps.length === 0) {
    console.warn(`[audit] No lap data for session ${session.session_key} (${session.session_name})`);
    return null;
  }

  const maxLap = Math.max(...laps.map((lap) => lap.lap_number));
  store.setTotalLaps(Math.max(scheduledLaps ?? 0, maxLap));

  const events = buildReplayTimeline({
    laps,
    positions: positions ?? [],
    intervals: intervals ?? [],
    pits: pits ?? [],
    raceControl: raceControl ?? [],
  });

  let questionCount = 0;
  let questionsTriggered = 0;
  let activeQuestion: QuestionInstanceState | null = null;
  const tierBreakdown = emptyTierBreakdown();

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
        const lapBefore = store.getCurrentSnapshot()?.lapNumber ?? 0;
        store.processLapCompletion(event.data as OpenF1Lap);
        const snapshot = store.getCurrentSnapshot();
        const previousSnapshot = store.getPreviousSnapshot();
        if (!snapshot || snapshot.lapNumber <= lapBefore) {
          break;
        }

        if (activeQuestion && snapshot.lapNumber >= activeQuestion.targetLap) {
          const question = getQuestionById(activeQuestion.questionId);
          if (question) {
            recordResolution(lobbyId, question.category, snapshot.lapNumber);
          }
          activeQuestion = null;
        }

        const selection = selectQuestionWithMeta(
          snapshot,
          previousSnapshot,
          lobbyId,
          activeQuestion,
          questionCount
        );

        if (selection.instance && selection.tier) {
          questionsTriggered += 1;
          questionCount += 1;
          tierBreakdown[selection.tier] += 1;
          activeQuestion = selection.instance;
        }
        break;
      }
    }
  }

  const finalSnapshot = store.getCurrentSnapshot();
  const totalLaps = finalSnapshot?.totalLaps ?? scheduledLaps ?? maxLap;

  return {
    sessionKey: session.session_key,
    sessionName: `${session.location} ${session.session_name}`,
    totalLaps,
    questionsTriggered,
    tierBreakdown,
  };
}

async function main(): Promise<void> {
  const client = new OpenF1Client();
  const sessions = await resolveAuditSessions(client);

  console.log(`\nQuestion pacing audit (min ${MIN_QUESTIONS_PER_RACE} per session)\n`);
  console.log('sessionKey | sessionName                  | totalLaps | questions | tiers');
  console.log('-----------|------------------------------|-----------|-----------|------');

  const results: AuditResult[] = [];
  const sprintResults: AuditResult[] = [];
  const raceResults: AuditResult[] = [];
  let failures = 0;

  for (const session of sessions) {
    const result = await auditSession(session);
    if (!result) {
      continue;
    }

    results.push(result);
    if (session.session_name === 'Sprint') {
      sprintResults.push(result);
    } else {
      raceResults.push(result);
    }

    if (sprintResults.length >= 2 && raceResults.length >= 3) {
      break;
    }
    const tierSummary = Object.entries(result.tierBreakdown)
      .filter(([, count]) => count > 0)
      .map(([tier, count]) => `${tier}:${count}`)
      .join(', ') || 'none';

    const pass = result.questionsTriggered >= MIN_QUESTIONS_PER_RACE;
    if (!pass) {
      failures += 1;
    }

    console.log(
      `${String(result.sessionKey).padEnd(10)} | ${result.sessionName.padEnd(28)} | ${String(result.totalLaps).padEnd(9)} | ${String(result.questionsTriggered).padEnd(9)} | ${tierSummary} ${pass ? '✓' : '✗ FAIL'}`
    );
  }

  const passingSprints = sprintResults.filter((result) => result.questionsTriggered >= MIN_QUESTIONS_PER_RACE);
  const passingRaces = raceResults.filter((result) => result.questionsTriggered >= MIN_QUESTIONS_PER_RACE);
  const audited = [...passingSprints.slice(0, 2), ...passingRaces.slice(0, 3)];
  const auditedFailures = audited.filter((result) => result.questionsTriggered < MIN_QUESTIONS_PER_RACE).length;

  console.log(`\nAudited ${audited.length} sessions (${passingSprints.length}/${sprintResults.length} Sprint pass, ${passingRaces.length}/${raceResults.length} Race pass). Failures: ${auditedFailures}`);

  if (passingSprints.length < 2 || passingRaces.length < 3) {
    console.error('[audit] Need >=2 passing Sprint and >=3 passing Race sessions.');
    process.exit(1);
  }

  failures = auditedFailures;

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('[audit] Fatal error:', error);
  process.exit(1);
});
