// @ts-nocheck
import supabase from '../db/supabaseClient';
import { restoreOrBootstrapLeaderboard } from './leaderboardArchive';
import { trackDbQuery, trackDbWrite } from '../observability/dbMetrics';
export { sanitizeUsernameForPublic } from './usernameSanitizer';

const DEFAULT_MAX_PLAYERS_PER_LOBBY = 30;

export function normalizeLateJoinLap(lap: number | null | undefined): number | null {
  if (lap == null || !Number.isFinite(lap) || lap <= 1) {
    return null;
  }
  return Math.floor(lap);
}

export async function findWaitingPublicLobbyIds(sessionKey: string): Promise<string[]> {
  trackDbQuery('public_lobby.find_waiting');
  const { data, error } = await supabase
    .from('lobbies')
    .select('id')
    .eq('is_public', true)
    .eq('public_session_key', sessionKey)
    .eq('status', 'waiting');

  if (error) {
    throw new Error(`Failed to find waiting public lobbies: ${error.message}`);
  }

  return (data ?? []).map((row) => row.id);
}

export async function findActivePublicLobbyId(sessionKey: string): Promise<string | null> {
  trackDbQuery('public_lobby.find_active');
  const { data, error } = await supabase
    .from('lobbies')
    .select('id')
    .eq('is_public', true)
    .eq('public_session_key', sessionKey)
    .eq('status', 'active')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find active public lobby: ${error.message}`);
  }

  return data?.id ?? null;
}

export async function patchUserJoinedAtLap(userId: string, joinedAtLap: number): Promise<void> {
  trackDbWrite('users.joined_at_lap');
  const { error } = await supabase
    .from('users')
    .update({ joined_at_lap: joinedAtLap })
    .eq('id', userId);

  if (error) {
    throw new Error(`Failed to patch joined_at_lap: ${error.message}`);
  }
}

export interface PublicLobbyJoinResult {
  lobbyId: string;
  lobbyCode: string;
  userId: string;
  username: string;
  isNewLobby: boolean;
  joinedAtLap: number | null;
}

/**
 * Atomically find an open public lobby for the given session and insert the
 * user, OR signal that a new lobby must be created.
 *
 * Returns null when the RPC signals NEEDS_NEW_LOBBY — the caller must then
 * call createPublicLobby() and start the session.
 *
 * Handles USERNAME_TAKEN by appending a random suffix and retrying (max 3x).
 */
export async function joinExistingPublicLobby(
  sessionKey: string,
  username: string,
  currentLap: number | null,
  maxPlayers: number = DEFAULT_MAX_PLAYERS_PER_LOBBY,
  attempt = 0
): Promise<PublicLobbyJoinResult | 'NEEDS_NEW_LOBBY'> {
  const lapForDb = normalizeLateJoinLap(currentLap);

  trackDbQuery('public_lobby.join_atomic');
  const { data, error } = await supabase.rpc('join_public_lobby_atomic', {
    p_session_key: sessionKey,
    p_max_players: maxPlayers,
    p_username: username,
    p_current_lap: lapForDb,
  });

  if (error) {
    throw new Error(`join_public_lobby_atomic failed: ${error.message}`);
  }

  const row = data?.[0];
  if (!row) {
    throw new Error('join_public_lobby_atomic returned no rows');
  }

  if (row.result_code === 'NEEDS_NEW_LOBBY') {
    return 'NEEDS_NEW_LOBBY';
  }

  if (row.result_code === 'USERNAME_TAKEN') {
    if (attempt >= 3) {
      const rand = Math.floor(Math.random() * 9000) + 1000;
      const altUsername = `${username}_${rand}`;
      return joinExistingPublicLobby(sessionKey, altUsername, currentLap, maxPlayers, attempt + 1);
    }
    const rand = Math.floor(Math.random() * 900) + 100;
    const altUsername = `${username}_${rand}`;
    return joinExistingPublicLobby(sessionKey, altUsername, currentLap, maxPlayers, attempt + 1);
  }

  if (row.result_code !== 'OK' || !row.out_lobby_id || !row.out_user_id) {
    throw new Error(`Unexpected result from join_public_lobby_atomic: ${row.result_code}`);
  }

  return {
    lobbyId: row.out_lobby_id,
    lobbyCode: row.out_lobby_code,
    userId: row.out_user_id,
    username,
    isNewLobby: false,
    joinedAtLap: lapForDb,
  };
}

/**
 * Create a brand-new public lobby for the given session.
 * The first user is inserted as host (internally) so the DB constraint is met,
 * but the frontend will not show the Host badge for public lobbies.
 */
export async function createPublicLobby(
  sessionKey: string,
  firstUsername: string
): Promise<{ lobbyId: string; lobbyCode: string; userId: string; lobbyCode6: string }> {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function generateCode(): string {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  // Find unique code
  let code = generateCode();
  for (let attempts = 0; attempts < 10; attempts++) {
    const { data: existing } = await supabase
      .from('lobbies')
      .select('code')
      .eq('code', code)
      .single();
    if (!existing) break;
    code = generateCode();
  }

  trackDbWrite('public_lobby.create');
  const { data: lobby, error: lobbyError } = await supabase
    .from('lobbies')
    .insert({
      code,
      session_id: sessionKey,
      status: 'waiting',
      question_count: 0,
      is_public: true,
      public_session_key: sessionKey,
    })
    .select()
    .single();

  if (lobbyError || !lobby) {
    throw new Error(`Failed to create public lobby: ${lobbyError?.message}`);
  }

  // Insert first user as host (internal only — not shown in UI for public lobbies)
  trackDbWrite('public_lobby.insert_first_user');
  const { data: user, error: userError } = await supabase
    .from('users')
    .insert({
      username: firstUsername,
      lobby_id: lobby.id,
      is_host: true,
      joined_at_lap: null,
    })
    .select()
    .single();

  if (userError || !user) {
    await supabase.from('lobbies').delete().eq('id', lobby.id);
    throw new Error(`Failed to insert first user into public lobby: ${userError?.message}`);
  }

  // Update lobby host_id
  await supabase.from('lobbies').update({ host_id: user.id }).eq('id', lobby.id);

  await restoreOrBootstrapLeaderboard(lobby.id, user.id);

  return {
    lobbyId: lobby.id,
    lobbyCode: lobby.code,
    userId: user.id,
    lobbyCode6: lobby.code,
  };
}

export function getDefaultMaxPlayers(): number {
  return (
    Number.parseInt(process.env.MAX_PLAYERS_PER_LOBBY ?? '', 10) || DEFAULT_MAX_PLAYERS_PER_LOBBY
  );
}
