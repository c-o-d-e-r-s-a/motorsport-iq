// @ts-nocheck
// Type checking disabled for Supabase complex generic types
// @ts-nocheck - Supabase type inference issues with generic client
import { v4 as uuidv4 } from 'uuid';
import type { Lobby, User, QuestionInstance } from '../db/types';
import supabase from '../db/supabaseClient';
import { trackDbQuery, trackDbWrite } from '../observability/dbMetrics';
import { enrichLobbyState } from './shareUrl';
import {
  archiveLeaderboardForInactivePlayer,
  restoreOrBootstrapLeaderboard,
  type LeaderboardBootstrapResult,
} from './leaderboardArchive';
import { MIN_QUESTIONS_PER_RACE, MAX_QUESTIONS_PER_RACE } from '../engine/questionEngine';
import type {
  LobbyState,
  PlayerState,
  LeaderboardEntryState,
  QuestionInstanceState,
  SessionMode,
  ResolutionEvent,
} from '../types';

/**
 * Lobby Manager - Handle lobby creation, joining, and state management
 */

// In-memory lobby state cache (for fast access)
const lobbyStates: Map<string, LobbyState> = new Map();
const userLobbies: Map<string, string> = new Map(); // userId -> lobbyId
const lastPersistedActivityAt: Map<string, number> = new Map();
const DEFAULT_MAX_PLAYERS_PER_LOBBY = 30;

export type PlayerRemovalReason = 'inactive' | 'disconnected_timeout' | 'left';

interface LobbyRuntimeMeta {
  sessionMode: SessionMode | null;
  replaySpeed: number | null;
  isReplayComplete: boolean;
  isSimulation: boolean;
}

const defaultRuntimeMeta = (): LobbyRuntimeMeta => ({
  sessionMode: null,
  replaySpeed: null,
  isReplayComplete: false,
  isSimulation: false,
});

const lobbyRuntimeMeta: Map<string, LobbyRuntimeMeta> = new Map();

export interface RemovePlayerResult {
  lobbyId: string;
  lobbyCode: string;
  lobbyDeleted: boolean;
  nextHostId: string | null;
  remainingPlayerIds: string[];
}

/**
 * Generate a random 6-character lobby code
 */
export function generateLobbyCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing characters
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Create a new lobby
 */
export async function createLobby(
  username: string,
  sessionId?: string,
  options?: { isPublic?: boolean; publicSessionKey?: string }
): Promise<{ lobby: Lobby; user: User }> {
  // Generate unique lobby code
  let code = generateLobbyCode();
  let attempts = 0;
  while (attempts < 10) {
    const existing = await supabase
      .from('lobbies')
      .select('code')
      .eq('code', code)
      .single();

    if (!existing.data) break;
    code = generateLobbyCode();
    attempts++;
  }

  trackDbWrite('lobbies.insert');
  const { data: lobby, error: lobbyError } = await supabase
    .from('lobbies')
    .insert({
      code,
      session_id: sessionId ?? null,
      status: 'waiting',
      question_count: 0,
      is_public: options?.isPublic ?? false,
      public_session_key: options?.publicSessionKey ?? null,
    })
    .select()
    .single();

  if (lobbyError || !lobby) {
    throw new Error(`Failed to create lobby: ${lobbyError?.message}`);
  }

  // Create host user
  const { data: user, error: userError } = await supabase
    .from('users')
    .insert({
      username,
      lobby_id: lobby.id,
      is_host: true,
    })
    .select()
    .single();

  if (userError || !user) {
    // Clean up lobby
    await supabase.from('lobbies').delete().eq('id', lobby.id);
    throw new Error(`Failed to create user: ${userError?.message}`);
  }

  // Update lobby with host
  await supabase
    .from('lobbies')
    .update({ host_id: user.id })
    .eq('id', lobby.id);

  const bootstrap = await restoreOrBootstrapLeaderboard(lobby.id, user.id);

  // Initialize in-memory state
  const lobbyState: LobbyState = {
    id: lobby.id,
    code: lobby.code,
    hostId: user.id,
    sessionId: lobby.session_id,
    status: 'waiting',
    sessionMode: null,
    replaySpeed: null,
    isReplayComplete: false,
    isSimulation: false,
    isPublic: options?.isPublic ?? false,
    players: [{ id: user.id, username, isHost: true, connected: true }],
    currentQuestion: null,
    latestResolution: null,
    questionCount: 0,
    minQuestions: MIN_QUESTIONS_PER_RACE,
    maxQuestions: MAX_QUESTIONS_PER_RACE,
    leaderboard: [{
      userId: user.id,
      username,
      points: bootstrap.entry.points,
      streak: bootstrap.entry.streak,
      maxStreak: bootstrap.entry.maxStreak,
      correctAnswers: bootstrap.entry.correctAnswers,
      wrongAnswers: bootstrap.entry.wrongAnswers,
      questionsAnswered: bootstrap.entry.questionsAnswered,
      accuracy: bootstrap.entry.accuracy,
    }],
  };
  lobbyStates.set(lobby.id, lobbyState);
  userLobbies.set(user.id, lobby.id);

  return { lobby, user };
}

/**
 * Join an existing lobby
 */
function normalizeJoinedAtLapForDisplay(joinedAtLap: number | null | undefined): number | undefined {
  if (joinedAtLap == null || joinedAtLap <= 1) {
    return undefined;
  }

  return joinedAtLap;
}

function resolveJoinedAtLapForJoin(
  bootstrap: LeaderboardBootstrapResult,
  requestedJoinedAtLap: number | null | undefined
): number | null {
  if (bootstrap.restored) {
    return bootstrap.joinedAtLap;
  }

  return requestedJoinedAtLap ?? null;
}

export async function joinLobby(
  lobbyCode: string,
  username: string,
  options?: { joinedAtLap?: number | null; restoreUserId?: string | null }
): Promise<{ lobby: Lobby; user: User }> {
  // Find lobby by code
  const { data: lobby, error: lobbyError } = await supabase
    .from('lobbies')
    .select()
    .eq('code', lobbyCode.toUpperCase())
    .single();

  if (lobbyError || !lobby) {
    throw new Error('Lobby not found');
  }

  if (lobby.status === 'finished') {
    throw new Error('This lobby has already finished');
  }

  // Check if username is taken
  const { data: existingUser } = await supabase
    .from('users')
    .select()
    .eq('lobby_id', lobby.id)
    .eq('username', username)
    .single();

  if (existingUser) {
    throw new Error('Username already taken');
  }

  const maxPlayers = Number.parseInt(process.env.MAX_PLAYERS_PER_LOBBY ?? '', 10)
    || DEFAULT_MAX_PLAYERS_PER_LOBBY;
  trackDbQuery('users.count_by_lobby');
  const { count: playerCount, error: playerCountError } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('lobby_id', lobby.id);

  if (playerCountError) {
    throw new Error('Failed to validate lobby capacity');
  }

  if ((playerCount ?? 0) >= maxPlayers) {
    throw new Error('Lobby is full');
  }

  // Create user — score restores keep their original join lap, not the rejoin lap.
  const initialJoinedAtLap = options?.restoreUserId
    ? null
    : (options?.joinedAtLap ?? null);

  const { data: user, error: userError } = await supabase
    .from('users')
    .insert({
      username,
      lobby_id: lobby.id,
      is_host: false,
      joined_at_lap: initialJoinedAtLap,
    })
    .select()
    .single();

  if (userError || !user) {
    throw new Error(`Failed to join lobby: ${userError?.message}`);
  }

  const bootstrap = await restoreOrBootstrapLeaderboard(lobby.id, user.id, {
    restoreUserId: options?.restoreUserId ?? null,
  });
  const effectiveJoinedAtLap = resolveJoinedAtLapForJoin(bootstrap, options?.joinedAtLap);

  if (effectiveJoinedAtLap !== initialJoinedAtLap) {
    trackDbWrite('users.joined_at_lap');
    await supabase
      .from('users')
      .update({ joined_at_lap: effectiveJoinedAtLap })
      .eq('id', user.id);
  }

  const displayJoinedAtLap = normalizeJoinedAtLapForDisplay(effectiveJoinedAtLap);

  // Update in-memory state
  let lobbyState = lobbyStates.get(lobby.id);
  if (!lobbyState) {
    lobbyState = await getLobbyState(lobby.id);
  }
  if (lobbyState) {
    lobbyState.players.push({
      id: user.id,
      username,
      isHost: false,
      connected: true,
      joinedAtLap: displayJoinedAtLap,
    });
    updateLeaderboardCache(lobby.id, user.id, {
      username,
      points: bootstrap.entry.points,
      streak: bootstrap.entry.streak,
      maxStreak: bootstrap.entry.maxStreak,
      correctAnswers: bootstrap.entry.correctAnswers,
      wrongAnswers: bootstrap.entry.wrongAnswers,
      questionsAnswered: bootstrap.entry.questionsAnswered,
      accuracy: bootstrap.entry.accuracy,
      joinedAtLap: displayJoinedAtLap,
    });
    userLobbies.set(user.id, lobby.id);
  }

  return { lobby, user };
}

/**
 * Get lobby by ID
 */
export async function getLobby(lobbyId: string): Promise<Lobby | null> {
  const { data, error } = await supabase
    .from('lobbies')
    .select()
    .eq('id', lobbyId)
    .single();

  if (error) return null;
  return data;
}

/**
 * Get lobby by code
 */
export async function getLobbyByCode(code: string): Promise<Lobby | null> {
  const { data, error } = await supabase
    .from('lobbies')
    .select()
    .eq('code', code.toUpperCase())
    .single();

  if (error) return null;
  return data;
}

/**
 * Get full lobby state
 */
export async function getLobbyState(lobbyId: string): Promise<LobbyState | null> {
  // Check in-memory cache first
  const cached = lobbyStates.get(lobbyId);
  if (cached) {
    return enrichLobbyState(cached);
  }

  trackDbQuery('lobby_state.load');
  const { data: lobby, error: lobbyError } = await supabase
    .from('lobbies')
    .select()
    .eq('id', lobbyId)
    .single();

  if (lobbyError || !lobby) return null;

  // Fetch players
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select()
    .eq('lobby_id', lobbyId);

  if (usersError) return null;

  // Fetch leaderboard
  const { data: leaderboard, error: lbError } = await supabase
    .from('leaderboard')
    .select()
    .eq('lobby_id', lobbyId);

  if (lbError) return null;

  // Build state
  const lobbyState: LobbyState = {
    id: lobby.id,
    code: lobby.code,
    hostId: lobby.host_id ?? '',
    sessionId: lobby.session_id,
    status: lobby.status,
    sessionMode: lobbyRuntimeMeta.get(lobbyId)?.sessionMode ?? null,
    replaySpeed: lobbyRuntimeMeta.get(lobbyId)?.replaySpeed ?? null,
    isReplayComplete: lobbyRuntimeMeta.get(lobbyId)?.isReplayComplete ?? false,
    isSimulation: lobbyRuntimeMeta.get(lobbyId)?.isSimulation ?? false,
    isPublic: (lobby as any).is_public ?? false,
    players: (users ?? []).map((u) => ({
      id: u.id,
      username: u.username,
      isHost: u.is_host,
      connected: true, // Assume connected on initial load
      joinedAtLap: normalizeJoinedAtLapForDisplay((u as { joined_at_lap?: number | null }).joined_at_lap),
    })),
    currentQuestion: null, // Would need to fetch active question
    latestResolution: null,
    questionCount: lobby.question_count,
    minQuestions: MIN_QUESTIONS_PER_RACE,
    maxQuestions: MAX_QUESTIONS_PER_RACE,
    leaderboard: (leaderboard ?? []).map((lb) => {
      const user = users?.find((u) => u.id === lb.user_id);
      const joinedAtLap = (user as { joined_at_lap?: number | null } | undefined)?.joined_at_lap;
      return {
        userId: lb.user_id,
        username: user?.username ?? '',
        points: lb.points,
        streak: lb.streak,
        maxStreak: lb.max_streak,
        correctAnswers: lb.correct_answers,
        wrongAnswers: lb.wrong_answers,
        questionsAnswered: lb.questions_answered,
        accuracy: lb.accuracy,
        joinedAtLap: normalizeJoinedAtLapForDisplay(joinedAtLap),
      };
    }),
  };

  // Cache it
  lobbyStates.set(lobbyId, lobbyState);

  return enrichLobbyState(lobbyState);
}

/**
 * Update lobby status
 */
export async function updateLobbyStatus(
  lobbyId: string,
  status: 'waiting' | 'active' | 'finished'
): Promise<void> {
  const updates: any = { status };

  if (status === 'active') {
    updates.started_at = new Date().toISOString();
  } else if (status === 'finished') {
    updates.finished_at = new Date().toISOString();
  }

  await supabase.from('lobbies').update(updates).eq('id', lobbyId);

  // Update cache
  const lobbyState = lobbyStates.get(lobbyId);
  if (lobbyState) {
    lobbyState.status = status;
  }
}

/**
 * Set lobby session
 */
export async function setLobbySession(lobbyId: string, sessionId: string): Promise<void> {
  await supabase
    .from('lobbies')
    .update({ session_id: sessionId })
    .eq('id', lobbyId);

  const lobbyState = lobbyStates.get(lobbyId);
  if (lobbyState) {
    lobbyState.sessionId = sessionId;
  }
}

export function setLobbyRuntimeMeta(
  lobbyId: string,
  updates: Partial<LobbyRuntimeMeta>
): void {
  const next = {
    ...defaultRuntimeMeta(),
    ...(lobbyRuntimeMeta.get(lobbyId) ?? {}),
    ...updates,
  };
  lobbyRuntimeMeta.set(lobbyId, next);

  const lobbyState = lobbyStates.get(lobbyId);
  if (lobbyState) {
    lobbyState.sessionMode = next.sessionMode;
    lobbyState.replaySpeed = next.replaySpeed;
    lobbyState.isReplayComplete = next.isReplayComplete;
    lobbyState.isSimulation = next.isSimulation;
  }
}

export function clearLobbyRuntimeMeta(lobbyId: string): void {
  lobbyRuntimeMeta.delete(lobbyId);
}

export async function touchUserActivity(userId: string): Promise<void> {
  trackDbWrite('users.last_active_at');
  await supabase
    .from('users')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', userId);
  lastPersistedActivityAt.set(userId, Date.now());
}

export async function flushUserActivity(userId: string): Promise<void> {
  await touchUserActivity(userId);
}

export async function touchUserActivityThrottled(userId: string, minIntervalMs: number): Promise<void> {
  const now = Date.now();
  const lastPersisted = lastPersistedActivityAt.get(userId) ?? 0;
  if (now - lastPersisted < minIntervalMs) {
    return;
  }

  await touchUserActivity(userId);
}

/**
 * Increment question count
 */
export async function incrementQuestionCount(lobbyId: string): Promise<number> {
  const lobby = await getLobby(lobbyId);
  const newCount = (lobby?.question_count ?? 0) + 1;
  await supabase
    .from('lobbies')
    .update({ question_count: newCount })
    .eq('id', lobbyId);

  const lobbyState = lobbyStates.get(lobbyId);
  if (lobbyState) {
    lobbyState.questionCount = newCount;
  }

  return newCount;
}

/**
 * Set current question
 */
export function setCurrentQuestion(lobbyId: string, question: QuestionInstanceState | null): void {
  const lobbyState = lobbyStates.get(lobbyId);
  if (lobbyState) {
    lobbyState.currentQuestion = question;
  }
}

export function setLatestResolution(lobbyId: string, resolution: ResolutionEvent | null): void {
  const lobbyState = lobbyStates.get(lobbyId);
  if (lobbyState) {
    lobbyState.latestResolution = resolution;
  }
}

/**
 * Update player connection status
 */
export function updatePlayerConnection(userId: string, connected: boolean): void {
  const lobbyId = userLobbies.get(userId);
  if (!lobbyId) return;

  const lobbyState = lobbyStates.get(lobbyId);
  if (!lobbyState) return;

  const player = lobbyState.players.find((p) => p.id === userId);
  if (player) {
    player.connected = connected;
  }
}

/**
 * Remove player from lobby
 */
export async function removePlayer(
  userId: string,
  options?: { reason?: PlayerRemovalReason }
): Promise<RemovePlayerResult | null> {
  const lobbyId = userLobbies.get(userId);
  if (!lobbyId) return null;

  const lobbyState = await getLobbyState(lobbyId);
  if (!lobbyState) {
    userLobbies.delete(userId);
    return null;
  }

  const removedPlayer = lobbyState.players.find((player) => player.id === userId);
  const remainingPlayers = lobbyState.players.filter((player) => player.id !== userId);
  const nextHostId = lobbyState.hostId === userId
    ? remainingPlayers[0]?.id ?? null
    : lobbyState.hostId;

  if ((options?.reason === 'inactive' || options?.reason === 'left') && removedPlayer?.username) {
    await archiveLeaderboardForInactivePlayer({
      lobbyId,
      userId,
      username: removedPlayer.username,
      joinedAtLap: removedPlayer.joinedAtLap ?? null,
    });
  }

  // Delete from database
  await supabase.from('users').delete().eq('id', userId);

  const shouldDeleteLobby =
    remainingPlayers.length === 0 &&
    // Keep public active lobbies alive so new solo players can refill them.
    // The stale-lobby cleanup will remove them after they go inactive.
    !(lobbyState.isPublic && lobbyState.status === 'active');

  if (shouldDeleteLobby) {
    await supabase.from('lobbies').delete().eq('id', lobbyId);
  } else if (nextHostId !== lobbyState.hostId && !lobbyState.isPublic) {
    await supabase.from('lobbies').update({ host_id: nextHostId }).eq('id', lobbyId);
  }

  // Update in-memory cache
  const cachedLobbyState = lobbyStates.get(lobbyId);
  if (cachedLobbyState) {
    cachedLobbyState.players = remainingPlayers.map((player) => ({
      ...player,
      isHost: player.id === nextHostId,
    }));
    cachedLobbyState.leaderboard = cachedLobbyState.leaderboard.filter((lb) => lb.userId !== userId);
    cachedLobbyState.hostId = nextHostId ?? '';
  }

  userLobbies.delete(userId);
  lastPersistedActivityAt.delete(userId);

  if (shouldDeleteLobby) {
    clearLobbyRuntimeMeta(lobbyId);
    clearLobbyCache(lobbyId);
    return {
      lobbyId,
      lobbyCode: lobbyState.code,
      lobbyDeleted: true,
      nextHostId: null,
      remainingPlayerIds: [],
    };
  }

  return {
    lobbyId,
    lobbyCode: lobbyState.code,
    lobbyDeleted: false,
    nextHostId,
    remainingPlayerIds: remainingPlayers.map((player) => player.id),
  };
}

/**
 * Get lobby ID for a user
 */
export function getUserLobby(userId: string): string | null {
  return userLobbies.get(userId) ?? null;
}

export function registerUserLobby(userId: string, lobbyId: string): void {
  userLobbies.set(userId, lobbyId);
}

/**
 * Register an in-memory lobby state for a public lobby that was created
 * directly by publicLobbyManager (bypassing the normal createLobby path).
 */
export function registerPublicLobbyState(state: LobbyState): void {
  lobbyStates.set(state.id, state);
  for (const player of state.players) {
    userLobbies.set(player.id, state.id);
  }
}

export function hasPlayersInLobby(lobbyId: string): boolean {
  const lobbyState = lobbyStates.get(lobbyId);
  return Boolean(lobbyState && lobbyState.players.length > 0);
}

export async function getUserLobbyFromDatabase(userId: string): Promise<string | null> {
  const { data: user, error } = await supabase
    .from('users')
    .select('lobby_id')
    .eq('id', userId)
    .single();

  if (error || !user?.lobby_id) {
    return null;
  }

  const { data: lobby, error: lobbyError } = await supabase
    .from('lobbies')
    .select('id')
    .eq('id', user.lobby_id)
    .single();

  if (lobbyError || !lobby) {
    return null;
  }

  userLobbies.set(userId, lobby.id);
  return lobby.id;
}

/**
 * Update leaderboard in cache
 */
export function updateLeaderboardCache(
  lobbyId: string,
  userId: string,
  updates: Partial<LeaderboardEntryState>
): void {
  const lobbyState = lobbyStates.get(lobbyId);
  if (!lobbyState) return;

  const entry = lobbyState.leaderboard.find((lb) => lb.userId === userId);
  if (entry) {
    Object.assign(entry, updates);
  } else {
    lobbyState.leaderboard.push({
      userId,
      username: updates.username ?? '',
      points: updates.points ?? 0,
      streak: updates.streak ?? 0,
      maxStreak: updates.maxStreak ?? 0,
      correctAnswers: updates.correctAnswers ?? 0,
      wrongAnswers: updates.wrongAnswers ?? 0,
      questionsAnswered: updates.questionsAnswered ?? 0,
      accuracy: updates.accuracy ?? 0,
    });
  }

  // Sort leaderboard
  lobbyState.leaderboard.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
    return b.maxStreak - a.maxStreak;
  });
}

/**
 * Delete a lobby from the database and clear local runtime/cache state.
 */
export async function destroyLobby(lobbyId: string): Promise<{ lobbyId: string; lobbyCode: string } | null> {
  let lobbyCode = lobbyStates.get(lobbyId)?.code;

  if (!lobbyCode) {
    const { data: lobby } = await supabase
      .from('lobbies')
      .select('code')
      .eq('id', lobbyId)
      .single();
    lobbyCode = lobby?.code ?? null;
  }

  trackDbWrite('lobbies.delete');
  const { error } = await supabase.from('lobbies').delete().eq('id', lobbyId);
  if (error) {
    throw new Error(`Failed to delete lobby ${lobbyId}: ${error.message}`);
  }

  clearLobbyRuntimeMeta(lobbyId);
  clearLobbyCache(lobbyId);

  if (!lobbyCode) {
    return null;
  }

  return { lobbyId, lobbyCode };
}

/**
 * Clear lobby from cache
 */
export function clearLobbyCache(lobbyId: string): void {
  const lobbyState = lobbyStates.get(lobbyId);
  if (lobbyState) {
    for (const player of lobbyState.players) {
      userLobbies.delete(player.id);
      lastPersistedActivityAt.delete(player.id);
    }
    lobbyStates.delete(lobbyId);
  }
}
