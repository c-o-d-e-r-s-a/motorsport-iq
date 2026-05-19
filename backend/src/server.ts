import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import supabase from './db/supabaseClient';
import type {
  CreateProblemReportInput,
  Difficulty,
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
import { selectQuestion, clearCooldowns, formatQuestionText } from './engine/questionEngine';
import { SessionRuntimeManager, toSessionInfo } from './runtime/sessionRuntimeManager';
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

const app = express();
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://motorsport-iq.vercel.app',
];

// Temporary development endpoint to verify direct connection and handshake with F1 SignalR hub
import { F1SignalRClient } from './data/f1SignalRClient';

app.get('/test-signalr', async (req, res) => {
  try {
    const client = new F1SignalRClient();
    await client.start();
    
    setTimeout(() => {
      client.stop();
    }, 30000); 

    res.json({ status: 'SignalR test started, check your backend console logs!' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

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
const lifecycleQueue = new LobbyLifecycleQueue();
const runtimeManager = new SessionRuntimeManager({
  onSnapshotUpdate: (snapshot, lobbyIds) => {
    broadcastRaceSnapshot(snapshot, lobbyIds);
  },
  onLapComplete: async (snapshot, lobbyIds) => {
    for (const lobbyId of lobbyIds) {
      await lifecycleQueue.enqueue(lobbyId, async () => {
        await checkAndResolveQuestion(lobbyId, snapshot);
        await checkAndTriggerQuestion(lobbyId, snapshot);
      });
    }
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
  await touchUserActivity(userId);
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

    io.to(lobbyId).emit('question_event', {
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

  io.to(lobbyId).emit('question_state', {
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

  // Broadcast updated leaderboard
  if (lobbyState) {
    io.to(lobbyId).emit('leaderboard_update', lobbyState.leaderboard);
  }
}

/**
 * Broadcast race snapshot to relevant lobbies
 */
function broadcastRaceSnapshot(snapshot: RaceSnapshot, lobbyIds: Set<string>): void {
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

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  let currentUserId: string | null = null;
  let currentLobbyId: string | null = null;

  /**
   * Create a new lobby
   */
  socket.on('create_lobby', async (data: { username: string; sessionId?: string }) => {
    try {
      const { lobby, user } = await createLobby(data.username, data.sessionId);
      currentUserId = user.id;
      currentLobbyId = lobby.id;

      socket.join(lobby.id);
      presenceManager.upsertConnection({ userId: user.id, lobbyId: lobby.id, socketId: socket.id });
      await touchUserActivity(user.id);

      const lobbyState = await getLobbyState(lobby.id);
      socket.emit('lobby_state', lobbyState);

      console.log(`Lobby created: ${lobby.code} by ${data.username}`);
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

      // Notify others in the lobby
      socket.to(lobby.id).emit('player_joined', {
        userId: user.id,
        username: user.username,
      });

      console.log(`${data.username} joined lobby ${lobby.code}`);
    } catch (error) {
      emitSocketError(socket, (error as Error).message);
    }
  });

  /**
   * Start the session (host only)
   */
  socket.on('start_session', async (data: { lobbyId: string; sessionId: string; userId?: string | null }) => {
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

      const session = await sessionLookupClient.getSession(parseInt(data.sessionId, 10));
      if (!session) {
        throw new Error('OpenF1 session not found');
      }
      if (new Date(session.date_end).getTime() >= Date.now()) {
        throw new Error('This session has not completed yet');
      }

      // Update lobby status
      await updateLobbyStatus(data.lobbyId, 'active');
      await setLobbySession(data.lobbyId, data.sessionId);
      setLatestResolution(data.lobbyId, null);

      const runtime = await runtimeManager.attachLobbyToSession(data.lobbyId, session);
      setLobbyRuntimeMeta(data.lobbyId, {
        sessionMode: runtime.mode,
        replaySpeed: runtime.replaySpeed,
        isReplayComplete: false,
      });

      // Notify all players
      io.to(data.lobbyId).emit('session_started', {
        sessionId: data.sessionId,
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

      console.log(`Session ${data.sessionId} started for lobby ${lobbyState.code}`);
    } catch (error) {
      emitSocketError(socket, (error as Error).message);
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

      const result = await submitAnswer(data.instanceId, currentUserId, data.answer);
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

      // Send current state
      const refreshedLobbyState = await getLobbyState(lobbyId);
      socket.emit('lobby_state', refreshedLobbyState ?? lobbyState);
      if (refreshedLobbyState) {
        io.to(lobbyId).emit('lobby_state', refreshedLobbyState);
      }

      if (lobbyState.sessionId) {
        const snapshot = runtimeManager.getRuntimeForLobby(lobbyId)?.getCurrentSnapshot();
        if (snapshot) {
          socket.emit('race_snapshot_update', toRaceSnapshotEvent(snapshot));
        }
      }

      // Send active question if any
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

        if (activeQuestion.state !== 'LIVE') {
          socket.emit('question_state', {
            instanceId: activeQuestion.id,
            state: activeQuestion.state,
            cancelledReason: activeQuestion.cancelledReason,
          });
        }
      }

      if (lobbyState.latestResolution) {
        socket.emit('resolution_event', lobbyState.latestResolution);
      }

      console.log(`User ${data.userId} reconnected to lobby ${lobbyId}`);
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
   * Get available sessions
   */
  socket.on('get_sessions', async (data: { year?: number }) => {
    try {
      const year = data?.year || new Date().getFullYear();
      const sessions = await sessionLookupClient.getSessions(year);
      const supportedSessions = (sessions ?? [])
        .filter((session) => ['Race', 'Sprint'].includes(session.session_name))
        .sort(
          (a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime()
        )
        .map((session) => toSessionInfo(session));
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

    const disconnectedPresence = presenceManager.markDisconnectedBySocket(socket.id);
    if (currentUserId && currentLobbyId && disconnectedPresence) {
      updatePlayerConnection(currentUserId, false);
      socket.to(currentLobbyId).emit('player_disconnected', { userId: currentUserId });
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
  clearAllTimers();
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  presenceManager.stop();
  clearAllTimers();
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

/* TEMPORARY STEP 3 BACKDOOR TEST ROUTE
app.get('/debug-force-live', async (req, res) => {
  try {
    console.log("\n [Debug Backdoor] Manually forcing a Live Session Runtime initialization...");
    
    // 1. Mock an active live F1 session object (99999 represents a live session key)
    const mockLiveSession = {
      session_key: 9158,
      session_name: "Simulated Canadian GP Live",
      date_start: new Date().toISOString(),
      date_end: new Date(Date.now() + 3600000).toISOString() // Ends 1 hour in the future = Forces Live mode!
    };

    // 2. In your server.ts, runtimeManager is directly accessible in this scope!
    console.log("[Debug Backdoor] Triggering attachLobbyToSession...");
    await runtimeManager.attachLobbyToSession("test-debug-lobby-id", mockLiveSession as any);

    res.json({ 
      success: true,
      message: "LiveSessionRuntime ignition sequence triggered! Check your backend terminal console logs right now." 
    });
  } catch (err: any) {
    console.error("Backdoor test failed:", err);
    res.status(500).json({ error: err.message });
  }
});
*/

// Start server
httpServer.listen(PORT, () => {
  console.log(`Motorsport IQ server running on port ${PORT}`);
  console.log(`[CORS] Allowed origins: ${allowedOrigins.join(', ')}`);
});

export { io, app, httpServer };
