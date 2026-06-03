import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import supabase from './db/supabaseClient';
import type {
  CreateProblemReportInput,
  Difficulty,
  LobbyState,
  ProblemReportStatus,
  QuestionCategory,
  QuestionInstanceState,
  RaceSnapshot,
  RaceSnapshotEvent,
  ServerErrorEvent,
} from './types';
import {
  createLobby,
  joinLobby,
  getLobbyState,
  getLobbyByCode,
  updateLobbyStatus,
  setLobbySession,
  setLobbyRuntimeMeta,
  setLatestResolution,
  updatePlayerConnection,
  removePlayer,
  getUserLobby,
  getUserLobbyFromDatabase,
  registerUserLobby,
  touchUserActivity,
  touchUserActivityThrottled,
  flushUserActivity,
} from './lobby/lobbyManager';
import {
  startQuestionLifecycle,
  submitAnswer,
  getActiveQuestion,
  getAnswerDeadline,
  checkForResolution,
  resumeQuestion,
  clearAllTimers,
  clearLobbyLifecycle,
} from './lobby/lifecycleManager';
import { LobbyLifecycleQueue } from './lobby/lifecycleQueue';
import { generateQuestionText } from './ai/explanationGenerator';
import { OpenF1Client } from './data/openf1Client';
import {
  dedupeWeekendSessions,
  DEFAULT_SIMULATION_SESSION_KEY,
  getActiveLiveCalendarSession,
  getCalendarSession,
  getCalendarSessions,
  mergeWithCalendar,
} from './data/f1Calendar';
import {
  ensureSeasonCalendar,
  seedSeasonCalendar,
  startSeasonCalendarRefresh,
  stopSeasonCalendarRefresh,
} from './data/seasonCalendarStore';
import { selectQuestion, clearCooldowns, formatQuestionText } from './engine/questionEngine';
import { SessionRuntimeManager, toSessionInfo, normalizeReplaySpeed } from './runtime/sessionRuntimeManager';
import { PresenceManager, type PresenceExpiryReason } from './lobby/presenceManager';
import { buildQuestionEventPayload, isUnresolvedQuestionState } from './lobby/questionPayload';
import {
  clearAdminSessionCookie,
  requireAdminSession,
  setAdminSessionCookie,
  updateAdminPassword,
  validateAdminPassword,
} from './admin/auth';
import {
  createOrUpdateProblemReport,
  isProblemReportStatus,
  listProblemReports,
  updateProblemReportStatus,
} from './admin/reporting';
import { generateSuggestedStatKeys } from './ai/statHintGenerator';
import { getQuestionById } from './engine/questionBank';
import type { CorsOptions } from 'cors';
import { metrics } from './observability/metrics';
import { closeRedisRuntime, createRedisRuntime } from './runtime/redis';
import { createDistributedLockManager } from './runtime/distributedLock';
import {
  FF_BATCH_SCORING,
  FF_DELTA_LOBBY_STATE,
  FF_PRESENCE_WRITE_THROTTLE,
  SIMULATION_ENABLED,
} from './runtime/featureFlags';

const app = express();
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://motorsport-iq.vercel.app',
];

function normalizeOriginValue(origin: string): string {
  return origin.trim().replace(/\/+$/, '');
}

function parseAllowedOrigins(value: string | undefined): string[] {
  const configuredOrigins = value
    ?.split(',')
    .map((origin) => normalizeOriginValue(origin))
    .filter(Boolean) ?? [];

  const allowedOrigins = configuredOrigins.length > 0
    ? configuredOrigins
    : DEFAULT_ALLOWED_ORIGINS;

  return [...new Set(allowedOrigins.map((origin) => normalizeOriginValue(origin)))];
}

const allowedOrigins = parseAllowedOrigins(process.env.CORS_ORIGIN);
const DEFAULT_PRESENCE_DISCONNECT_GRACE_MS = 2 * 60 * 1000;

function parsePositiveNumberEnv(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

const presenceDisconnectGraceMs = parsePositiveNumberEnv(
  process.env.PRESENCE_DISCONNECT_GRACE_MS,
  DEFAULT_PRESENCE_DISCONNECT_GRACE_MS
);
const presenceDbWriteMinIntervalMs = parsePositiveNumberEnv(
  process.env.PRESENCE_DB_WRITE_MIN_INTERVAL_MS,
  5 * 60 * 1000
);
const lapWorkConcurrency = parsePositiveNumberEnv(
  process.env.LOBBY_LAP_CONCURRENCY,
  20
);
const maxActiveLobbies = parsePositiveNumberEnv(
  process.env.MAX_ACTIVE_LOBBIES,
  500
);

async function assertActiveLobbyCapacity(): Promise<void> {
  const { count: activeLobbyCount, error } = await supabase
    .from('lobbies')
    .select('*', { count: 'exact', head: true })
    .in('status', ['waiting', 'active']);

  if (error) {
    throw new Error('Unable to validate lobby capacity');
  }

  if ((activeLobbyCount ?? 0) >= maxActiveLobbies) {
    throw new Error('Server is at active-lobby capacity. Try again shortly.');
  }
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const limit = Math.max(1, concurrency);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }).map(async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) {
        return;
      }

      await worker(items[index]);
    }
  });

  await Promise.all(runners);
}

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  const normalizedOrigin = normalizeOriginValue(parsed.origin);
  const hostname = parsed.hostname.toLowerCase();
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
  const isVercelDomain = hostname === 'motorsport-iq.vercel.app' || hostname.endsWith('.vercel.app');

  return allowedOrigins.includes(normalizedOrigin) || isLocalhost || isVercelDomain;
}

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (isOriginAllowed(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin ${origin ?? 'unknown'} is not allowed by CORS`));
  },
  methods: ['GET', 'POST', 'PATCH'],
  credentials: true,
};
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: corsOptions,
});
const redisRuntime = process.env.FF_REDIS_ADAPTER === 'true'
  ? createRedisRuntime()
  : null;
if (redisRuntime) {
  io.adapter(redisRuntime.attachSocketIoAdapter);
}
const distributedLocks = createDistributedLockManager(redisRuntime?.pub);

const PORT = process.env.PORT || 4000;

function emitSocketError(
  socket: { emit: (event: string, payload: ServerErrorEvent) => void },
  message: string,
  code: ServerErrorEvent['code'] = 'UNKNOWN'
): void {
  socket.emit('error', { message, code });
}

function toRaceSnapshotEvent(snapshot: RaceSnapshot): RaceSnapshotEvent {
  const leader = snapshot.drivers[0] ?? null;

  return {
    sessionId: snapshot.sessionId,
    lapNumber: snapshot.lapNumber,
    totalLaps: snapshot.totalLaps,
    trackStatus: snapshot.trackStatus,
    sessionMode: snapshot.sessionMode,
    replaySpeed: snapshot.replaySpeed,
    isReplayComplete: snapshot.isReplayComplete,
    timestamp: snapshot.timestamp.toISOString(),
    leaderLapTime: snapshot.leaderLapTime,
    leaderLapStartTime: snapshot.leaderLapStartTime,
    leader: leader?.name ?? '',
    leaderNameSource: leader?.nameSource ?? 'unknown',
    leaderTelemetryTimestamp: leader?.lastTelemetryTimestamp ?? null,
    leaderStats: leader
      ? {
          name: leader.name,
          team: leader.team,
          tyreCompound: leader.tyreCompound,
          tyreAge: leader.tyreAge,
          stintNumber: leader.stintNumber,
        }
      : null,
    topThree: snapshot.drivers.slice(0, 3).map((driver) => driver.name),
    dataFeedStalled: snapshot.dataFeedStalled,
  };
}

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Health check
app.get('/health', async (req, res) => {
  try {
    // Test Supabase connection by querying a simple table
    const { data, error } = await supabase.from('lobbies').select('id').limit(1);

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      supabase: error ? 'error' : 'connected',
      supabaseError: error?.message || null,
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      supabase: 'error',
      error: (err as Error).message,
    });
  }
});

// Supabase connectivity test
app.get('/health/supabase', async (req, res) => {
  try {
    const { data, error } = await supabase.from('lobbies').select('id').limit(1);
    if (error) throw error;
    res.json({ status: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: 'error', error: (err as Error).message });
  }
});

app.get('/health/scaling', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    targets: {
      users500: true,
      nextMilestoneUsers: 5000,
    },
    limits: {
      maxPlayersPerLobby: Number.parseInt(process.env.MAX_PLAYERS_PER_LOBBY ?? '', 10) || 75,
      maxActiveLobbies,
      lapWorkConcurrency,
      presenceDbWriteMinIntervalMs,
    },
    featureFlags: {
      FF_BATCH_SCORING,
      FF_PRESENCE_WRITE_THROTTLE,
      FF_DELTA_LOBBY_STATE,
      FF_REDIS_ADAPTER: process.env.FF_REDIS_ADAPTER === 'true',
      FF_JOB_QUEUE: process.env.FF_JOB_QUEUE === 'true',
    },
    metrics: metrics.snapshot(),
  });
});

app.get('/metrics', (_req, res) => {
  res.json(metrics.snapshot());
});

app.post('/reports', async (req, res) => {
  try {
    const { instanceId, userId, reason, note } = req.body as CreateProblemReportInput;
    if (!instanceId || !userId || !reason) {
      res.status(400).json({ message: 'instanceId, userId, and reason are required' });
      return;
    }

    const result = await createOrUpdateProblemReport({ instanceId, userId, reason, note });
    res.json({ success: true, id: result.id });
  } catch (error) {
    res.status(400).json({ message: (error as Error).message });
  }
});

app.post('/admin/login', async (req, res) => {
  try {
    const password = String(req.body?.password ?? '');
    if (!password) {
      res.status(400).json({ message: 'Password is required' });
      return;
    }

    const isValid = await validateAdminPassword(password);
    if (!isValid) {
      res.status(401).json({ message: 'Incorrect password' });
      return;
    }

    setAdminSessionCookie(res);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: (error as Error).message });
  }
});

app.post('/admin/logout', requireAdminSession, async (req, res) => {
  clearAdminSessionCookie(res);
  res.json({ success: true });
});

app.post('/admin/change-password', requireAdminSession, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword ?? '');
    const nextPassword = String(req.body?.newPassword ?? '');

    if (!currentPassword || !nextPassword) {
      res.status(400).json({ message: 'Current and new password are required' });
      return;
    }

    if (nextPassword.length < 10) {
      res.status(400).json({ message: 'New password must be at least 10 characters' });
      return;
    }

    await updateAdminPassword(currentPassword, nextPassword);
    clearAdminSessionCookie(res);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ message: (error as Error).message });
  }
});

app.get('/admin/reports', requireAdminSession, async (req, res) => {
  try {
    const reports = await listProblemReports();
    res.json({ reports });
  } catch (error) {
    res.status(500).json({ message: (error as Error).message });
  }
});

app.patch('/admin/reports/:id', requireAdminSession, async (req, res) => {
  try {
    const status = String(req.body?.status ?? '') as ProblemReportStatus;
    const reportId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!isProblemReportStatus(status)) {
      res.status(400).json({ message: 'Invalid report status' });
      return;
    }

    if (!reportId) {
      res.status(400).json({ message: 'Report id is required' });
      return;
    }

    await updateProblemReportStatus(reportId, status);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ message: (error as Error).message });
  }
});

const sessionLookupClient = new OpenF1Client();
const bootYear = new Date().getFullYear();
const bootstrapSessions = getCalendarSessions(bootYear);
if (bootstrapSessions.length > 0) {
  seedSeasonCalendar(bootYear, bootstrapSessions);
}
startSeasonCalendarRefresh(async (year) => sessionLookupClient.getSessions(year));
const lifecycleQueue = new LobbyLifecycleQueue();
const runtimeManager = new SessionRuntimeManager({
  onSnapshotUpdate: (snapshot, lobbyIds) => {
    metrics.setGauge('runtime.live_lobbies', lobbyIds.size);
    broadcastRaceSnapshot(snapshot, lobbyIds);
  },
  onLapComplete: async (snapshot, lobbyIds) => {
    metrics.incrementCounter('runtime.lap_complete_events_total');
    metrics.setGauge('runtime.lap_complete_lobby_count', lobbyIds.size);
    const lobbyIdList = [...lobbyIds];
    await metrics.trackAsync('runtime.lap_complete_processing_ms', async () => {
      await runWithConcurrency(lobbyIdList, lapWorkConcurrency, async (lobbyId) => {
        const lockKey = `lap:${lobbyId}:${snapshot.lapNumber}`;
        const lockToken = await distributedLocks.acquire(lockKey, 20_000);
        if (!lockToken) {
          metrics.incrementCounter('runtime.lap_lock_skipped_total');
          return;
        }

        await lifecycleQueue.enqueue(lobbyId, async () => {
          await checkAndResolveQuestion(lobbyId, snapshot);
          await checkAndTriggerQuestion(lobbyId, snapshot);
          metrics.setGauge('runtime.lifecycle_active_lobbies', lifecycleQueue.getActiveLobbyCount());
          metrics.setGauge('runtime.lifecycle_pending_tasks', lifecycleQueue.getPendingTaskCount());
        }).finally(async () => {
          await distributedLocks.release(lockKey, lockToken);
        });
      });
    });
  },
  onFeedStall: (stalled, lobbyIds) => {
    for (const lobbyId of lobbyIds) {
      io.to(lobbyId).emit('feed_status', { stalled });
    }
  },
  onReplayComplete: async (snapshot, lobbyIds) => {
    for (const lobbyId of lobbyIds) {
      await updateLobbyStatus(lobbyId, 'finished');
      setLobbyRuntimeMeta(lobbyId, { isReplayComplete: true });
      clearCooldowns(lobbyId);

      const lobbyState = await getLobbyState(lobbyId);
      if (snapshot) {
        io.to(lobbyId).emit('race_snapshot_update', toRaceSnapshotEvent({
          ...snapshot,
          isReplayComplete: true,
        }));
      }
      if (lobbyState) {
        io.to(lobbyId).emit('lobby_state', lobbyState);
      }
    }
  },
  onError: (error) => {
    console.error('Session runtime error:', error);
  },
});

async function handleUserRemoval(
  userId: string,
  reason: PresenceExpiryReason | 'left',
  socketId?: string | null
): Promise<void> {
  const removal = await removePlayer(userId);
  if (!removal) {
    return;
  }

  presenceManager.removeUser(userId);

  if (reason !== 'left' && socketId) {
    const targetSocket = io.sockets.sockets.get(socketId);
    if (targetSocket) {
      targetSocket.emit('presence_expired', { reason });
      targetSocket.disconnect(true);
    }
  }

  if (removal.lobbyDeleted) {
    clearCooldowns(removal.lobbyId);
    clearLobbyLifecycle(removal.lobbyId);
    runtimeManager.detachLobbyFromSession(removal.lobbyId);
    return;
  }

  io.to(removal.lobbyId).emit('player_left', { userId });
  if (FF_DELTA_LOBBY_STATE) {
    return;
  }

  const nextState = await getLobbyState(removal.lobbyId);
  if (nextState) {
    io.to(removal.lobbyId).emit('lobby_state', nextState);
  }
}

const presenceManager = new PresenceManager({
  disconnectGraceMs: presenceDisconnectGraceMs,
  sweepIntervalMs: 60 * 1000, // Changed from 30s to 60s to reduce CPU overhead
  onExpire: async (entry, reason) => {
    await handleUserRemoval(entry.userId, reason, entry.socketId);
  },
});

async function markUserActive(userId: string): Promise<void> {
  presenceManager.markSeen(userId);
  if (FF_PRESENCE_WRITE_THROTTLE) {
    await touchUserActivityThrottled(userId, presenceDbWriteMinIntervalMs);
  } else {
    await touchUserActivity(userId);
  }
  metrics.incrementCounter('presence.ping_total');
}

function emitQuestionEvent(lobbyId: string, payload: unknown): void {
  const startedAt = Date.now();
  io.to(lobbyId).emit('question_event', payload);
  metrics.recordDuration('socket.question_event_delivery_ms', Date.now() - startedAt);
  metrics.incrementCounter('socket.question_event_total');
}

function emitQuestionState(lobbyId: string, payload: unknown): void {
  const startedAt = Date.now();
  io.to(lobbyId).emit('question_state', payload);
  metrics.recordDuration('socket.question_state_delivery_ms', Date.now() - startedAt);
  metrics.incrementCounter('socket.question_state_total');
}

/**
 * Check and trigger a new question for a lobby
 */
async function checkAndTriggerQuestion(lobbyId: string, snapshot: RaceSnapshot): Promise<void> {
  const lobbyState = await getLobbyState(lobbyId);
  if (!lobbyState || lobbyState.status !== 'active') return;

  const existingQuestion = getActiveQuestion(lobbyId);
  if (existingQuestion) {
    return;
  }

  // Check if SC/VSC - resume paused questions
  if (snapshot.trackStatus === 'GREEN') {
    await resumeQuestion(
      lobbyId,
      snapshot,
      (result) => handleResolution(lobbyId, result),
      (instance) => handleStateChange(lobbyId, instance)
    );
  }

  if (getActiveQuestion(lobbyId)) {
    return;
  }

  // Try to select a new question
  const previousSnapshot = runtimeManager.getRuntimeForLobby(lobbyId)?.getPreviousSnapshot() ?? null;

  // ──── AI TRIGGER DETECTION — high-visibility logs for scenario/debug testing ──
  if (snapshot.trackStatus === 'YELLOW' || snapshot.trackStatus === 'SC' || snapshot.trackStatus === 'VSC') {
    console.log(`\n⚠️  ============================================`);
    console.log(`⚠️  ${snapshot.trackStatus} FLAG DETECTED (lobby=${lobbyId}, lap=${snapshot.lapNumber})`);
    console.log(`⚠️  AI Question Generator SUPPRESSED — caution period active`);
    console.log(`⚠️  ============================================\n`);
  } else if (snapshot.trackStatus === 'CHEQUERED') {
    console.log(`\n🏆 CHEQUERED FLAG (lobby=${lobbyId}, lap=${snapshot.lapNumber}) — race over, no new questions`);
  } else if (previousSnapshot && snapshot.trackStatus === 'GREEN') {
    for (const driver of snapshot.drivers) {
      const prev = previousSnapshot.drivers.find((d) => d.driverNumber === driver.driverNumber);
      if (prev && prev.position > driver.position && driver.position <= 3) {
        console.log(`\n🔴 ============================================`);
        console.log(`🔴 OVERTAKE DETECTED (lobby=${lobbyId}, lap=${snapshot.lapNumber})`);
        console.log(`🔴 ${driver.name}: P${prev.position} → P${driver.position}`);
        console.log(`🔴 Triggering AI Question Generator...`);
        console.log(`🔴 ============================================\n`);
      }
    }
  }

  const newQuestion = selectQuestion(
    snapshot,
    previousSnapshot,
    lobbyId,
    null,
    lobbyState.questionCount
  );

  if (newQuestion) {
    // PERFORMANCE OPTIMIZATION: Generate fallback text immediately to avoid blocking on AI
    const questionDef = getQuestionById(newQuestion.questionId);
    const fallbackText = questionDef && newQuestion.driver1
      ? formatQuestionText(questionDef, newQuestion.driver1, newQuestion.driver2 ?? null)
      : 'Will this prediction come true?';

    // Set initial question text to fallback before any emission so reconnect state is truthful.
    newQuestion.questionText = fallbackText;
    setLatestResolution(lobbyId, null);
    console.log(`[QUESTION_TRIGGER] lobby=${lobbyId} instance=${newQuestion.id} question=${newQuestion.questionId} state=${newQuestion.state}`);

    // Start lifecycle first so the active-question guard is visible to concurrent lap updates.
    await startQuestionLifecycle(
      newQuestion,
      (instance) => handleStateChange(lobbyId, instance),
      (result) => handleResolution(lobbyId, result)
    );

    emitQuestionEvent(lobbyId, {
      ...buildQuestionEventPayload(
        newQuestion,
        getQuestionCategory(newQuestion.questionId),
        getQuestionDifficulty(newQuestion.questionId)
      ),
      suggestedStatKeys: [],
    });

    // PERFORMANCE OPTIMIZATION: Fire AI generation in background
    const aiStartTime = Date.now();
    generateQuestionText(newQuestion).then(async (aiText) => {
      const aiDuration = Date.now() - aiStartTime;
      if (aiDuration > 1000) {
        console.log(`[PERF] AI question generation took ${aiDuration}ms (slow)`);
      }

      // Only emit update if AI text is different from fallback
      if (aiText !== fallbackText) {
        newQuestion.questionText = aiText;

        // Generate suggested stat keys based on AI text
        const suggestedStatKeys = await generateSuggestedStatKeys({
          questionText: aiText,
          category: questionDef?.category ?? 'GAP_CLOSING',
          snapshot,
        });
        newQuestion.suggestedStatKeys = suggestedStatKeys;

        // Broadcast updated question text and stat hints
        io.to(lobbyId).emit('question_text_update', {
          instanceId: newQuestion.id,
          questionText: aiText,
          suggestedStatKeys,
        });

        console.log(`[PERF] Broadcast AI text update for question ${newQuestion.questionId} in lobby ${lobbyId}`);
      }
    }).catch((error) => {
      console.error('[PERF] Failed to generate AI question text:', error);
    });
  }
}

/**
 * Check and resolve active question
 */
async function checkAndResolveQuestion(lobbyId: string, snapshot: RaceSnapshot): Promise<void> {
  await checkForResolution(
    lobbyId,
    snapshot,
    (result) => handleResolution(lobbyId, result),
    (instance) => handleStateChange(lobbyId, instance)
  );
}

/**
 * Handle question state change
 */
function handleStateChange(lobbyId: string, instance: QuestionInstanceState): void {
  const answerDeadline = instance.state === 'LIVE'
    ? getAnswerDeadline(instance.id)?.toISOString()
    : undefined;

  console.log(
    `[QUESTION_STATE] lobby=${lobbyId} instance=${instance.id} state=${instance.state}`
    + (answerDeadline ? ` deadline=${answerDeadline}` : '')
  );

  emitQuestionState(lobbyId, {
    instanceId: instance.id,
    state: instance.state,
    cancelledReason: instance.cancelledReason,
    answerDeadline,
  });

  // Pause/resume replay when question goes LIVE/LOCKED
  const runtime = runtimeManager.getRuntimeForLobby(lobbyId);
  if (runtime?.mode === 'replay') {
    if (instance.state === 'LIVE') {
      runtime.pause?.();
    } else if (instance.state === 'LOCKED') {
      runtime.resume?.();
    }
  }

  if (instance.state === 'LOCKED') {
    io.to(lobbyId).emit('question_locked', {
      instanceId: instance.id,
    });
  }

  if (instance.state === 'CANCELLED') {
    // Resume replay if question is cancelled
    if (runtime?.mode === 'replay') {
      runtime.resume?.();
    }
    io.to(lobbyId).emit('question_cancelled', {
      instanceId: instance.id,
      reason: instance.cancelledReason,
    });
  }
}

/**
 * Handle question resolution
 */
async function handleResolution(
  lobbyId: string,
  result: {
    instance: QuestionInstanceState;
    outcome: boolean;
    correctAnswer: 'YES' | 'NO';
    explanation: string;
  }
): Promise<void> {
  await metrics.trackAsync('socket.resolution_broadcast_ms', async () => {
    // Get updated leaderboard
    const lobbyState = await getLobbyState(lobbyId);
    const resolutionPayload = {
      instanceId: result.instance.id,
      questionId: result.instance.questionId,
      questionText: result.instance.questionText ?? '',
      correctAnswer: result.correctAnswer,
      outcome: result.outcome,
      explanation: result.explanation,
    };
    setLatestResolution(lobbyId, resolutionPayload);

    // Broadcast resolution
    io.to(lobbyId).emit('resolution_event', resolutionPayload);
    metrics.incrementCounter('socket.resolution_event_total');

    // Broadcast updated leaderboard
    if (lobbyState) {
      io.to(lobbyId).emit('leaderboard_update', lobbyState.leaderboard);
      metrics.incrementCounter('socket.leaderboard_update_total');
    }
  });
}

/**
 * Broadcast race snapshot to relevant lobbies
 */
function broadcastRaceSnapshot(snapshot: RaceSnapshot, lobbyIds: Set<string>): void {
  metrics.incrementCounter('socket.race_snapshot_update_total', lobbyIds.size);
  for (const lobbyId of lobbyIds) {
    io.to(lobbyId).emit('race_snapshot_update', toRaceSnapshotEvent(snapshot));
  }
}

/**
 * Get question category
 */
function getQuestionCategory(questionId: string): QuestionCategory {
  const question = getQuestionById(questionId);
  return question?.category ?? 'GAP_CLOSING';
}

/**
 * Get question difficulty
 */
function getQuestionDifficulty(questionId: string): Difficulty {
  const question = getQuestionById(questionId);
  return question?.difficulty ?? 'MEDIUM';
}

function emitSessionCatchUp(
  socket: { emit: (event: string, payload: unknown) => void },
  lobbyId: string,
  lobbyState: LobbyState
): void {
  if (lobbyState.sessionId) {
    const snapshot = runtimeManager.getRuntimeForLobby(lobbyId)?.getCurrentSnapshot();
    if (snapshot) {
      socket.emit('race_snapshot_update', toRaceSnapshotEvent(snapshot));
    }
  }

  const activeQuestion = getActiveQuestion(lobbyId);
  if (activeQuestion && isUnresolvedQuestionState(activeQuestion.state)) {
    socket.emit('question_event', buildQuestionEventPayload(
      activeQuestion,
      getQuestionCategory(activeQuestion.questionId),
      getQuestionDifficulty(activeQuestion.questionId),
      {
        answerDeadline: activeQuestion.state === 'LIVE' ? getAnswerDeadline(activeQuestion.id) : null,
      }
    ));

    socket.emit('question_state', {
      instanceId: activeQuestion.id,
      state: activeQuestion.state,
      cancelledReason: activeQuestion.cancelledReason,
      answerDeadline: activeQuestion.state === 'LIVE'
        ? getAnswerDeadline(activeQuestion.id)?.toISOString()
        : undefined,
    });
    return;
  }

  if (lobbyState.latestResolution) {
    socket.emit('resolution_event', lobbyState.latestResolution);
  }
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  metrics.incrementCounter('socket.connections_total');
  metrics.setGauge('socket.active_connections', io.sockets.sockets.size);

  let currentUserId: string | null = null;
  let currentLobbyId: string | null = null;

  /**
   * Create a new lobby
   */
  socket.on('create_lobby', async (data: { username: string; sessionId?: string }) => {
    try {
      await assertActiveLobbyCapacity();

      const { lobby, user } = await createLobby(data.username, data.sessionId);
      currentUserId = user.id;
      currentLobbyId = lobby.id;

      socket.join(lobby.id);
      presenceManager.upsertConnection({ userId: user.id, lobbyId: lobby.id, socketId: socket.id });
      await touchUserActivity(user.id);

      const lobbyState = await getLobbyState(lobby.id);
      socket.emit('lobby_state', lobbyState);

      console.log(`Lobby created: ${lobby.code} by ${data.username}`);
      metrics.incrementCounter('lobby.created_total');
    } catch (error) {
      const message = (error as Error).message;
      const code = message.includes('active-lobby capacity') ? 'VALIDATION_ERROR' : 'UNKNOWN';
      emitSocketError(socket, message, code);
    }
  });

  /**
   * Look up a lobby by code without joining (for share-link flows)
   */
  socket.on('lookup_lobby', async (data: { lobbyCode: string }) => {
    try {
      const lobby = await getLobbyByCode(data.lobbyCode);
      if (!lobby) {
        emitSocketError(socket, 'Lobby not found', 'VALIDATION_ERROR');
        return;
      }

      socket.emit('lobby_lookup', {
        code: lobby.code,
        status: lobby.status,
        id: lobby.id,
      });
    } catch (error) {
      emitSocketError(socket, (error as Error).message);
    }
  });

  /**
   * Join an existing lobby
   */
  socket.on('join_lobby', async (data: { lobbyCode: string; username: string }) => {
    try {
      const { lobby, user } = await joinLobby(data.lobbyCode, data.username);
      currentUserId = user.id;
      currentLobbyId = lobby.id;

      socket.join(lobby.id);
      presenceManager.upsertConnection({ userId: user.id, lobbyId: lobby.id, socketId: socket.id });
      await touchUserActivity(user.id);

      const lobbyState = await getLobbyState(lobby.id);
      socket.emit('lobby_state', lobbyState);

      if (lobby.status === 'active' && lobbyState) {
        emitSessionCatchUp(socket, lobby.id, lobbyState);
      }

      // Notify others in the lobby
      socket.to(lobby.id).emit('player_joined', {
        userId: user.id,
        username: user.username,
      });

      console.log(`${data.username} joined lobby ${lobby.code}`);
      metrics.incrementCounter('lobby.joined_total');
    } catch (error) {
      emitSocketError(socket, (error as Error).message);
    }
  });

  /**
   * Start the session (host only)
   */
  socket.on('start_session', async (data: { lobbyId: string; sessionId: string; userId?: string | null; replaySpeed?: number | null }) => {
    try {
      const lobbyState = await getLobbyState(data.lobbyId);
      if (!lobbyState) {
        throw new Error('Lobby not found');
      }

      const actingUserId = currentUserId ?? data.userId ?? null;
      if (!actingUserId || lobbyState.hostId !== actingUserId) {
        throw new Error('Only the host can start the session');
      }

      currentUserId = actingUserId;
      currentLobbyId = data.lobbyId;
      await markUserActive(actingUserId);

      const requestedKey = parseInt(data.sessionId, 10);
      const calendarSession = Number.isFinite(requestedKey) ? getCalendarSession(requestedKey) : null;
      let session = calendarSession
        ?? (Number.isFinite(requestedKey) ? await sessionLookupClient.getSession(requestedKey) : null);
      if (!session) {
        throw new Error('Session not found');
      }

      // For race-style sessions we require either a completed session (replay)
      // OR an active live window. Calendar-backed sessions in the future are
      // gated until they go live; OpenF1-backed historical sessions are
      // replay-only and require completion.
      const sessionStart = new Date(session.date_start).getTime();
      const sessionEnd = new Date(session.date_end).getTime();
      const now = Date.now();
      const isLive = sessionStart <= now && now < sessionEnd;
      const isCompleted = sessionEnd < now;

      if (!isLive && !isCompleted) {
        throw new Error('This session has not started yet');
      }

      // Update lobby status
      await updateLobbyStatus(data.lobbyId, 'active');
      await setLobbySession(data.lobbyId, String(session.session_key));
      setLatestResolution(data.lobbyId, null);

      const requestedReplaySpeed = isCompleted && data.replaySpeed != null
        ? normalizeReplaySpeed(data.replaySpeed)
        : undefined;
      const runtime = await runtimeManager.attachLobbyToSession(data.lobbyId, session, {
        replaySpeed: requestedReplaySpeed,
      });
      setLobbyRuntimeMeta(data.lobbyId, {
        sessionMode: runtime.mode,
        replaySpeed: runtime.replaySpeed,
        isReplayComplete: false,
      });

      // Notify all players
      io.to(data.lobbyId).emit('session_started', {
        sessionId: String(session.session_key),
        mode: runtime.mode,
        replaySpeed: runtime.replaySpeed,
      });

      const refreshedLobbyState = await getLobbyState(data.lobbyId);
      if (refreshedLobbyState) {
        io.to(data.lobbyId).emit('lobby_state', refreshedLobbyState);
      }

      const snapshot = runtime.getCurrentSnapshot();
      if (snapshot) {
        broadcastRaceSnapshot(snapshot, new Set([data.lobbyId]));
      }

      console.log(`Session ${session.session_key} started for lobby ${lobbyState.code}`);
    } catch (error) {
      emitSocketError(socket, (error as Error).message);
    }
  });

  /**
   * Start an on-demand live-race simulation (dev/QA only).
   */
  socket.on('start_simulation', async (data: { username: string; sessionKey?: number }) => {
    try {
      if (!SIMULATION_ENABLED) {
        emitSocketError(socket, 'Simulation is disabled on this server', 'FORBIDDEN');
        return;
      }

      await assertActiveLobbyCapacity();

      const requestedKey = data.sessionKey ?? DEFAULT_SIMULATION_SESSION_KEY;
      const calendarSession = getCalendarSession(requestedKey);
      const resolvedSession = calendarSession
        ?? (Number.isFinite(requestedKey) ? await sessionLookupClient.getSession(requestedKey) : null);
      if (!resolvedSession) {
        emitSocketError(socket, 'Simulation session not found in season calendar', 'VALIDATION_ERROR');
        return;
      }

      const { lobby, user } = await createLobby(data.username, String(resolvedSession.session_key));
      currentUserId = user.id;
      currentLobbyId = lobby.id;

      socket.join(lobby.id);
      presenceManager.upsertConnection({ userId: user.id, lobbyId: lobby.id, socketId: socket.id });
      await touchUserActivity(user.id);

      await updateLobbyStatus(lobby.id, 'active');
      await setLobbySession(lobby.id, String(resolvedSession.session_key));
      setLatestResolution(lobby.id, null);

      const runtime = await runtimeManager.attachLobbyToSimulation(lobby.id, resolvedSession);
      setLobbyRuntimeMeta(lobby.id, {
        sessionMode: 'live',
        replaySpeed: null,
        isReplayComplete: false,
        isSimulation: true,
      });

      io.to(lobby.id).emit('session_started', {
        sessionId: String(resolvedSession.session_key),
        mode: runtime.mode,
        replaySpeed: runtime.replaySpeed,
      });

      const lobbyState = await getLobbyState(lobby.id);
      if (lobbyState) {
        socket.emit('lobby_state', lobbyState);
      }

      const snapshot = runtime.getCurrentSnapshot();
      if (snapshot) {
        broadcastRaceSnapshot(snapshot, new Set([lobby.id]));
      }

      console.log(`[Simulation] Started sim for lobby ${lobby.code} (session ${resolvedSession.session_key})`);
      metrics.incrementCounter('simulation.started_total');
    } catch (error) {
      const message = (error as Error).message;
      const code = message.includes('active-lobby capacity') ? 'VALIDATION_ERROR' : 'UNKNOWN';
      emitSocketError(socket, message, code);
    }
  });

  /**
   * Submit an answer
   */
  socket.on('submit_answer', async (data: { instanceId: string; answer: 'YES' | 'NO' }) => {
    try {
      if (!currentUserId) {
        throw new Error('Not authenticated');
      }

      await markUserActive(currentUserId);

      const result = await metrics.trackAsync('socket.submit_answer_ms', async () =>
        submitAnswer(data.instanceId, currentUserId!, data.answer)
      );
      console.log(
        `[ANSWER_SUBMIT] user=${currentUserId} instance=${data.instanceId} answer=${data.answer} success=${result.success}`
        + (result.error ? ` error="${result.error}"` : '')
      );

      if (result.success) {
        socket.emit('answer_received', { instanceId: data.instanceId });
      } else {
        emitSocketError(socket, result.error ?? 'Failed to submit answer', 'VALIDATION_ERROR');
      }
    } catch (error) {
      emitSocketError(socket, (error as Error).message);
    }
  });

  /**
   * Reconnect to lobby
   */
  socket.on('reconnect_lobby', async (data: { userId: string }) => {
    try {
      const reconnectStartedAt = Date.now();
      const lobbyId = getUserLobby(data.userId) ?? await getUserLobbyFromDatabase(data.userId);
      if (!lobbyId) {
        emitSocketError(socket, 'Session expired. You are no longer in a lobby.', 'SESSION_EXPIRED');
        return;
      }

      const lobbyState = await getLobbyState(lobbyId);
      if (!lobbyState) {
        emitSocketError(socket, 'Session expired. Lobby no longer exists.', 'SESSION_EXPIRED');
        return;
      }

      currentUserId = data.userId;
      currentLobbyId = lobbyId;
      registerUserLobby(data.userId, lobbyId);

      socket.join(lobbyId);
      updatePlayerConnection(data.userId, true);
      presenceManager.upsertConnection({ userId: data.userId, lobbyId, socketId: socket.id });
      await touchUserActivity(data.userId);

      socket.to(lobbyId).emit('player_reconnected', { userId: data.userId });

      // Send current state
      const refreshedLobbyState = await getLobbyState(lobbyId);
      socket.emit('lobby_state', refreshedLobbyState ?? lobbyState);

      if (lobbyState.sessionId) {
        emitSessionCatchUp(socket, lobbyId, refreshedLobbyState ?? lobbyState);
      }

      console.log(`User ${data.userId} reconnected to lobby ${lobbyId}`);
      metrics.incrementCounter('lobby.reconnect_total');
      metrics.recordDuration('socket.reconnect_recovery_ms', Date.now() - reconnectStartedAt);
    } catch (error) {
      emitSocketError(socket, (error as Error).message);
    }
  });

  socket.on('presence_ping', async () => {
    if (!currentUserId) {
      return;
    }

    await markUserActive(currentUserId);
  });

  /**
   * Get available sessions.
   *
   * When a calendar session is currently LIVE we deliberately short-circuit
   * the OpenF1 historical lookup:
   *   1. OpenF1's data endpoints return 401 "Live F1 session in progress"
   *      during the live window, so any historical replay attempt would
   *      fail anyway with confusing "cannot get previous data" errors.
   *   2. We surface ONLY the live race so the host can't accidentally pick
   *      a stale Sprint/Race entry and hit "session has not started yet".
   */
  socket.on('get_sessions', async (data: { year?: number }) => {
    try {
      metrics.incrementCounter('socket.get_sessions_total');
      const year = data?.year || new Date().getFullYear();

      await ensureSeasonCalendar(year, async (targetYear) => sessionLookupClient.getSessions(targetYear));

      const activeLiveSession = getActiveLiveCalendarSession();
      const liveIsPlayable = activeLiveSession
        && ['Race', 'Sprint'].includes(activeLiveSession.session_name);

      if (liveIsPlayable && activeLiveSession) {
        socket.emit('sessions_list', [toSessionInfo(activeLiveSession)]);
        return;
      }

      let openf1Sessions: Awaited<ReturnType<OpenF1Client['getSessions']>> = [];
      // Prefer cached schedule (includes emergency overrides). Fall back to OpenF1
      // /sessions listing — that endpoint stays available even when telemetry is live-locked.
      const cachedSessions = getCalendarSessions(year);
      if (cachedSessions.length > 0) {
        openf1Sessions = cachedSessions;
      } else {
        try {
          openf1Sessions = await sessionLookupClient.getSessions(year);
        } catch (lookupError) {
          console.warn(
            `[get_sessions] OpenF1 lookup failed for year=${year}; falling back to cached calendar only:`,
            (lookupError as Error).message
          );
        }
      }

      const merged = mergeWithCalendar(openf1Sessions ?? [], year);

      const filtered = merged
        .filter((session) => !/^practice\b/i.test(session.session_name))
        .filter((session) =>
          ['Race', 'Sprint'].includes(session.session_name)
        );

      const supportedSessions = dedupeWeekendSessions(filtered).map((session) => toSessionInfo(session));

      if (SIMULATION_ENABLED) {
        const simSession = getCalendarSession(DEFAULT_SIMULATION_SESSION_KEY);
        if (
          simSession
          && !supportedSessions.some((session) => session.session_key === simSession.session_key)
        ) {
          supportedSessions.unshift(toSessionInfo(simSession));
        }
      }

      socket.emit('sessions_list', supportedSessions);
    } catch (error) {
      emitSocketError(socket, 'Failed to fetch sessions');
    }
  });

  /**
   * Handle disconnect
   */
  socket.on('disconnect', async () => {
    console.log(`Client disconnected: ${socket.id}`);
    metrics.incrementCounter('socket.disconnect_total');
    metrics.setGauge('socket.active_connections', io.sockets.sockets.size);

    const disconnectedPresence = presenceManager.markDisconnectedBySocket(socket.id);
    if (currentUserId && currentLobbyId && disconnectedPresence) {
      updatePlayerConnection(currentUserId, false);
      if (FF_PRESENCE_WRITE_THROTTLE) {
        void flushUserActivity(currentUserId);
      }
      socket.to(currentLobbyId).emit('player_disconnected', { userId: currentUserId });
      if (FF_DELTA_LOBBY_STATE) {
        return;
      }

      const nextState = await getLobbyState(currentLobbyId);
      if (nextState) {
        io.to(currentLobbyId).emit('lobby_state', nextState);
      }
    }
  });

  /**
   * Leave lobby
   */
  socket.on('leave_lobby', async () => {
    if (currentUserId && currentLobbyId) {
      socket.leave(currentLobbyId);
      await handleUserRemoval(currentUserId, 'left');
      currentUserId = null;
      currentLobbyId = null;
    }
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  presenceManager.stop();
  stopSeasonCalendarRefresh();
  clearAllTimers();
  void closeRedisRuntime(redisRuntime).finally(() => {
    httpServer.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  presenceManager.stop();
  stopSeasonCalendarRefresh();
  clearAllTimers();
  void closeRedisRuntime(redisRuntime).finally(() => {
    httpServer.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
});

// Start server
httpServer.listen(PORT, () => {
  console.log(`Motorsport IQ server running on port ${PORT}`);
  console.log(`[CORS] Allowed origins: ${allowedOrigins.join(', ')}`);
  console.log(`[SCALING] Redis adapter: ${redisRuntime ? 'enabled' : 'disabled'}`);
  console.log(`[SCALING] Lap concurrency: ${lapWorkConcurrency}`);
  console.log(`[SCALING] Feature flags: batchScoring=${FF_BATCH_SCORING}, presenceThrottle=${FF_PRESENCE_WRITE_THROTTLE}, deltaLobbyState=${FF_DELTA_LOBBY_STATE}`);
});

export { io, app, httpServer };
