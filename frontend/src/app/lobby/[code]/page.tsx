'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSocketClient } from '@/lib/socket';
import {
  applyPlayerDisconnected,
  applyPlayerJoined,
  applyPlayerLeft,
  applyPlayerReconnected,
} from '@/lib/lobbyPlayerDeltas';
import { SERVER_EVENTS, type LobbyState, type ServerErrorEvent, type SessionInfo } from '@/lib/types';
import { shareLobbyLink } from '@/lib/shareLobbyLink';
import {
  filterSessionsForDisplay,
  isLivePlayableWindow,
  isPreRacePlayableWindow,
} from '@/lib/sessionDisplay';
import { Button, Brand, Card, Chip, Dialog, Input } from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  clearInactiveKickRestore,
  clearLobbySession,
  getInactiveKickRestore,
  getStoredLobbySession,
  saveLobbySession,
  stashInactiveKickRestore,
} from '@/lib/sessionPersistence';
import { resolveJoinedPlayer } from '@/lib/resolveJoinedPlayer';

export default function LobbyPage() {
  const params = useParams();
  const router = useRouter();
  const lobbyCode = params.code as string;

  const [lobbyState, setLobbyState] = useState<LobbyState | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedSession, setSelectedSession] = useState('');
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareLinkStatus, setShareLinkStatus] = useState<'shared' | 'copied' | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const [confirmSession, setConfirmSession] = useState<SessionInfo | null>(null);
  const [joinUsername, setJoinUsername] = useState(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('msp_username') ?? '';
  });
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const joinUsernameRef = useRef(joinUsername);
  const joinedUserIdRef = useRef<string | null>(null);

  const currentUserId = typeof window !== 'undefined' ? localStorage.getItem('msp_user_id') : null;

  const beginLobbyEntry = useCallback((socket: ReturnType<typeof getSocketClient>) => {
    const storedSession = getStoredLobbySession();
    const normalizedCode = lobbyCode.toUpperCase();

    if (storedSession && storedSession.lobbyCode.toUpperCase() === normalizedCode) {
      socket.reconnectLobby(storedSession.userId, { dedupeWindowMs: 0 });
      return;
    }

    if (storedSession) {
      clearLobbySession();
    }

    socket.lookupLobby(lobbyCode);
  }, [lobbyCode]);

  useEffect(() => {
    joinUsernameRef.current = joinUsername;
  }, [joinUsername]);

  useEffect(() => {
    const socket = getSocketClient();
    socket.connect();

    const unsubscribers = [
      socket.on('connected', () => {
        setIsReconnecting(false);
        setConnectionNotice(null);
        beginLobbyEntry(socket);
      }),
      socket.on(SERVER_EVENTS.LOBBY_LOOKUP, () => {
        if (!localStorage.getItem('msp_user_id')) {
          setShowJoinForm(true);
          setIsLoading(false);
        }
      }),
      socket.on('disconnected', ({ hidden }: { reason?: string; hidden?: boolean }) => {
        if (!hidden && document.visibilityState === 'visible') {
          setIsReconnecting(true);
        }
      }),
      socket.on('connection_error', ({ message }: { message: string }) => {
        setIsReconnecting(true);
        setConnectionNotice(message);
      }),
      socket.on(SERVER_EVENTS.JOIN_RESULT, (data: { userId: string; username: string }) => {
        joinedUserIdRef.current = data.userId;
        localStorage.setItem('msp_username', data.username);
      }),
      socket.on(SERVER_EVENTS.LOBBY_STATE, (state: LobbyState) => {
        setLobbyState(state);
        setIsLoading(false);
        setShowJoinForm(false);
        setIsJoining(false);

        const joinedUser = resolveJoinedPlayer(state, {
          userId: joinedUserIdRef.current,
          typedUsername: joinUsernameRef.current,
        });
        joinedUserIdRef.current = null;
        if (joinedUser) {
          saveLobbySession({
            userId: joinedUser.id,
            username: joinedUser.username,
            lobbyCode: state.code,
            lobbyStatus: state.status === 'waiting' ? 'waiting' : 'active',
          });
          clearInactiveKickRestore();
        }

        if (state.status === 'active') {
          router.push(`/game/${state.code}`);
        }
      }),
      socket.on(SERVER_EVENTS.PLAYER_JOINED, (data: { userId: string; username: string; joinedAtLap?: number }) => {
        setLobbyState((prev) => (prev ? applyPlayerJoined(prev, data) : prev));
      }),
      socket.on(SERVER_EVENTS.PLAYER_LEFT, (data: { userId: string }) => {
        setLobbyState((prev) => (prev ? applyPlayerLeft(prev, data) : prev));
      }),
      socket.on(SERVER_EVENTS.PLAYER_DISCONNECTED, (data: { userId: string }) => {
        setLobbyState((prev) => (prev ? applyPlayerDisconnected(prev, data) : prev));
      }),
      socket.on(SERVER_EVENTS.PLAYER_RECONNECTED, (data: { userId: string }) => {
        setLobbyState((prev) => (prev ? applyPlayerReconnected(prev, data) : prev));
      }),
      socket.on(SERVER_EVENTS.SESSION_STARTED, () => {
        router.push(`/game/${lobbyCode}`);
      }),
      socket.on(SERVER_EVENTS.SESSIONS_LIST, (sessionList: SessionInfo[]) => {
        setSessions(sessionList);
        if (sessionList.length > 0) {
          const liveSession = sessionList.find((session) => session.isLive);
          const preRaceSession = sessionList.find((session) => session.isPreRace);
          const firstCompleted = sessionList.find((session) => session.isCompleted);
          const firstPlayable = sessionList.find(
            (session) => session.isLive || session.isCompleted || session.isPreRace
          );
          setSelectedSession((current) => {
            if (current && sessionList.some((session) => String(session.session_key) === current)) {
              const stillRelevant = sessionList.some(
                (session) => String(session.session_key) === current
                  && (session.isLive || session.isCompleted || session.isPreRace)
              );
              if (stillRelevant) return current;
            }
            if (liveSession) return String(liveSession.session_key);
            if (preRaceSession) return String(preRaceSession.session_key);
            if (firstCompleted) return String(firstCompleted.session_key);
            return firstPlayable ? String(firstPlayable.session_key) : '';
          });
        }
      }),
      socket.on(SERVER_EVENTS.ERROR, ({ message, code }: ServerErrorEvent) => {
        const isSessionExpired = code === 'SESSION_EXPIRED'
          || message.toLowerCase().includes('user not in any lobby')
          || message.toLowerCase().includes('user not found')
          || message.toLowerCase().includes('session expired');

        if (isSessionExpired) {
          const kickedUserId = localStorage.getItem('msp_user_id');
          if (kickedUserId) {
            stashInactiveKickRestore(kickedUserId, lobbyCode);
          }
          clearLobbySession();
          setLobbyState(null);
          setShowJoinForm(true);
          setIsLoading(false);
          setConnectionNotice('You were away for a while. Re-enter your driver name to restore your score.');
          return;
        }

        setError(message);
        setIsStarting(false);
        setIsJoining(false);
        setIsLoading(false);
      }),
      socket.on(SERVER_EVENTS.PRESENCE_EXPIRED, () => {
        const kickedUserId = localStorage.getItem('msp_user_id');
        if (kickedUserId) {
          stashInactiveKickRestore(kickedUserId, lobbyCode);
        }
        clearLobbySession();
        setLobbyState(null);
        setShowJoinForm(true);
        setIsLoading(false);
        setConnectionNotice('You were away for a while. Re-enter your driver name to restore your score.');
      }),
    ];

    socket.startSessionsPolling(selectedYear, 60_000);

    if (socket.isConnected()) {
      beginLobbyEntry(socket);
    }

    return () => {
      socket.stopSessionsPolling();
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [beginLobbyEntry, lobbyCode, router, selectedYear]);

  useEffect(() => {
    if (!currentUserId) {
      return;
    }

    const socket = getSocketClient();
    socket.sendPresencePing();
    const interval = window.setInterval(() => {
      socket.sendPresencePing();
    }, 90_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [currentUserId]);

  useEffect(() => {
    const refreshPresence = () => {
      if (document.visibilityState === 'hidden') {
        getSocketClient().sendPresencePing();
        return;
      }

      const storedUserId = localStorage.getItem('msp_user_id');
      const storedLobbyCode = localStorage.getItem('msp_lobby_code');
      if (!storedUserId || storedLobbyCode?.toUpperCase() !== lobbyCode.toUpperCase()) {
        return;
      }

      getSocketClient().resumeAfterBackground();
    };

    document.addEventListener('visibilitychange', refreshPresence);
    window.addEventListener('focus', refreshPresence);

    return () => {
      document.removeEventListener('visibilitychange', refreshPresence);
      window.removeEventListener('focus', refreshPresence);
    };
  }, [lobbyCode]);

  const handleCopyCode = useCallback(() => {
    navigator.clipboard.writeText(lobbyCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [lobbyCode]);

  const handleShareLink = useCallback(async () => {
    const shareUrl = lobbyState?.shareUrl ?? `${window.location.origin}/lobby/${lobbyCode}`;
    try {
      const result = await shareLobbyLink({ url: shareUrl, code: lobbyCode });
      if (result === 'cancelled') {
        return;
      }
      setShareLinkStatus(result);
      setTimeout(() => setShareLinkStatus(null), 2000);
    } catch {
      setError('Could not share the lobby link. Try copying the code instead.');
    }
  }, [lobbyCode, lobbyState?.shareUrl]);

  const handleJoinLobby = useCallback(() => {
    if (!joinUsername.trim()) {
      setError('Please enter a username');
      return;
    }

    setError(null);
    setIsJoining(true);
    localStorage.setItem('msp_username', joinUsername.trim());
    getSocketClient().joinLobby(lobbyCode, joinUsername.trim(), {
      restoreUserId: getInactiveKickRestore(lobbyCode),
    });
  }, [joinUsername, lobbyCode]);

  const handleLeaveLobby = useCallback(() => {
    const userId = localStorage.getItem('msp_user_id');
    if (userId && lobbyCode) {
      stashInactiveKickRestore(userId, lobbyCode);
    }
    clearLobbySession();
    getSocketClient().leaveLobby();
    router.push('/');
  }, [router, lobbyCode]);

  const handleStartGame = useCallback((sessionKey?: string) => {
    const key = sessionKey ?? selectedSession;

    if (!lobbyState || !key) {
      setError('Please select a session');
      return;
    }

    const sessionInfo = sessions.find((session) => String(session.session_key) === key);
    if (!sessionInfo?.isLive && !sessionInfo?.isCompleted) {
      setError('This session has not started yet');
      return;
    }

    if (lobbyState.players.length < 1) {
      setError('Need at least 1 player to start');
      return;
    }

    setConfirmSession(null);
    setIsStarting(true);
    const replayOptions = sessionInfo?.isCompleted ? { replaySpeed: 1 } : undefined;
    getSocketClient().startSession(lobbyState.id, key, currentUserId, replayOptions);
  }, [currentUserId, lobbyState, selectedSession, sessions]);

  const handleSessionClick = useCallback((session: SessionInfo) => {
    const isSelectable = session.isLive || session.isCompleted;
    if (!isSelectable) {
      return;
    }

    const key = String(session.session_key);
    if (selectedSession === key) {
      setConfirmSession(session);
      return;
    }

    setSelectedSession(key);
  }, [selectedSession]);

  const displaySessions = useMemo(
    () => filterSessionsForDisplay(sessions),
    [sessions]
  );

  const isHost = lobbyState?.hostId === currentUserId;
  const selectedSessionInfo = displaySessions.find((session) => String(session.session_key) === selectedSession)
    ?? sessions.find((session) => String(session.session_key) === selectedSession)
    ?? null;
  const canStartSession = Boolean(
    selectedSession && selectedSessionInfo && (selectedSessionInfo.isLive || selectedSessionInfo.isCompleted)
  );

  const openStartConfirm = useCallback(() => {
    if (selectedSessionInfo && canStartSession) {
      setConfirmSession(selectedSessionInfo);
    }
  }, [canStartSession, selectedSessionInfo]);
  const liveSessionInList = displaySessions.find((session) => session.isLive) ?? null;
  const preRaceSessionInList = displaySessions.find((session) => session.isPreRace) ?? null;
  const liveOnlyMode = isLivePlayableWindow(sessions)
    || (Boolean(liveSessionInList) && displaySessions.length === 1);
  const preRaceOnlyMode = isPreRacePlayableWindow(sessions)
    || (Boolean(preRaceSessionInList) && displaySessions.length === 1);
  const isPublicWaiting = Boolean(lobbyState?.isPublic && lobbyState.status === 'waiting');
  const publicWaitingSession = preRaceSessionInList
    ?? displaySessions.find((session) => String(session.session_key) === lobbyState?.sessionId)
    ?? sessions.find((session) => String(session.session_key) === lobbyState?.sessionId)
    ?? null;

  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: currentYear - 2022 }, (_, index) => currentYear - index);
  }, []);

  if (isLoading) {
    return (
      <main className="app-bg flex min-h-dvh flex-col items-center justify-center gap-4 px-5 text-center">
        <span className="h-10 w-10 animate-spin-slow rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)]" />
        <p className="font-display text-lg uppercase tracking-wide text-[var(--color-muted-fg)]">Loading lobby…</p>
        {(connectionNotice || isReconnecting) && (
          <p className="max-w-sm text-sm text-[var(--color-muted-fg)]">
            {connectionNotice ?? 'Connecting to the race server…'}
          </p>
        )}
      </main>
    );
  }

  if (showJoinForm) {
    return (
      <main className="app-bg pad-safe-top pad-safe-bottom flex min-h-dvh items-center justify-center p-5">
        <Card tone="elevated" className="w-full max-w-md animate-fade-up rounded-[var(--radius-lg)]">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-accent)]">Rejoin lobby</p>
          <h1 className="mt-2 font-display text-5xl font-bold uppercase tracking-tight">{lobbyCode}</h1>
          <p className="mt-3 text-sm text-[var(--color-muted-fg)]">
            {connectionNotice ?? 'Enter your driver name to join. If the race is already live, you\'ll jump straight in.'}
          </p>
          <Input
            id="join-name"
            label="Driver name"
            value={joinUsername}
            onChange={(event) => setJoinUsername(event.target.value)}
            placeholder="Your name"
            className="mt-5"
          />
          {(connectionNotice || isReconnecting) && (
            <p className="mt-4 rounded-[var(--radius-sm)] bg-[var(--color-muted)] px-4 py-3 text-sm text-[var(--color-muted-fg)]">
              {connectionNotice ?? 'Connecting to the race server…'}
            </p>
          )}
          {error && (
            <p className="mt-4 rounded-[var(--radius-sm)] border border-[var(--color-accent)]/50 bg-[var(--color-accent-soft)] px-4 py-3 text-sm font-medium text-[var(--color-accent)]">
              {error}
            </p>
          )}
          <Button onClick={handleJoinLobby} disabled={isJoining || isReconnecting} size="lg" className="mt-6 w-full">
            {isJoining ? 'Joining…' : 'Join lobby'}
          </Button>
        </Card>
      </main>
    );
  }

  if (!lobbyState) {
    return (
      <main className="app-bg pad-safe-top flex min-h-dvh items-center justify-center p-5">
        <Card tone="elevated" className="w-full max-w-md rounded-[var(--radius-lg)] text-center">
          <p className="font-display text-4xl font-bold uppercase">Lobby not found</p>
          <p className="mt-2 text-sm text-[var(--color-muted-fg)]">This code may have expired or been entered incorrectly.</p>
          <Button onClick={() => router.push('/')} size="lg" className="mt-6 w-full">
            Back to home
          </Button>
        </Card>
      </main>
    );
  }

  return (
    <main className="app-bg pad-safe-top relative min-h-dvh">
      <div className="mx-auto w-full max-w-3xl px-5 pb-40">
        <header className="flex items-center justify-between py-4">
          <Brand variant="mark" />
          <Button variant="ghost" size="sm" onClick={handleLeaveLobby}>
            Leave
          </Button>
        </header>

        {/* Lobby code + invite */}
        <section className="surface-elevated animate-fade-up rounded-[var(--radius-lg)] p-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-faint-fg)]">
            Lobby code
          </p>
          <p className="mt-1 font-display text-6xl font-bold uppercase tracking-[0.1em] text-[var(--color-fg)]">
            {lobbyCode}
          </p>
          <p className="mt-2 text-sm text-[var(--color-muted-fg)]">Share this code so friends can join.</p>
          <div className="mt-5 grid grid-cols-2 gap-2.5">
            <Button variant="secondary" onClick={handleCopyCode}>
              {copied ? 'Copied ✓' : 'Copy code'}
            </Button>
            <Button variant="secondary" onClick={handleShareLink}>
              {shareLinkStatus === 'shared'
                ? 'Shared ✓'
                : shareLinkStatus === 'copied'
                  ? 'Link copied ✓'
                  : 'Share link'}
            </Button>
          </div>
          {(isReconnecting || connectionNotice) && (
            <p className="mt-4 rounded-[var(--radius-sm)] bg-[var(--color-muted)] px-4 py-2.5 text-sm text-[var(--color-muted-fg)]">
              {connectionNotice ?? 'Reconnecting to the race server…'}
            </p>
          )}
        </section>

        {/* Players */}
        <section className="animate-fade-up delay-1 mt-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold uppercase tracking-wide">
              Grid · {lobbyState.players.length}
            </h2>
          </div>
          <div className="space-y-2">
            {lobbyState.players.map((player) => (
              <div
                key={player.id}
                className="flex items-center gap-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-3"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: player.connected ? 'var(--color-go)' : 'var(--color-faint-fg)' }}
                />
                <p className="flex-1 truncate font-display text-lg font-semibold uppercase">{player.username}</p>
                <div className="flex gap-1.5">
                  {player.isHost && !lobbyState.isPublic && <Chip tone="accent">Host</Chip>}
                  {player.id === currentUserId && <Chip tone="neutral">You</Chip>}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Session setup / standby */}
        <section className="animate-fade-up delay-2 mt-6">
          {isPublicWaiting ? (
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-warn)]/40 bg-[rgba(255,196,0,0.08)] p-8 text-center">
              <p className="font-display text-2xl font-semibold uppercase text-[var(--color-warn)]">
                Race has not started yet
              </p>
              {publicWaitingSession ? (
                <>
                  <p className="mt-2 font-display text-lg font-semibold uppercase">
                    {publicWaitingSession.location}
                  </p>
                  <p className="mt-1 text-sm text-[var(--color-muted-fg)]">
                    {publicWaitingSession.session_name} · {publicWaitingSession.country_name}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-[var(--color-muted-fg)]">
                  Waiting for the session to go live…
                </p>
              )}
              <p className="mt-4 text-sm text-[var(--color-muted-fg)]">
                You&apos;re in the shared lobby with {lobbyState.players.length}{' '}
                {lobbyState.players.length === 1 ? 'racer' : 'racers'}.
                Everyone drops into the race automatically when lights go out.
              </p>
            </div>
          ) : isHost ? (
            <>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="font-display text-lg font-semibold uppercase tracking-wide">Pick a session</h2>
                {!liveOnlyMode && !preRaceOnlyMode && (
                  <select
                    value={selectedYear}
                    onChange={(event) => {
                      setSelectedYear(Number(event.target.value));
                      setSelectedSession('');
                    }}
                    className="h-10 rounded-[var(--radius-pill)] border border-[var(--color-border-strong)] bg-[var(--color-elevated)] px-4 font-display text-sm font-semibold uppercase focus-visible:border-[var(--color-accent)] focus-visible:outline-none"
                  >
                    {years.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {preRaceOnlyMode && (
                <p className="mb-3 rounded-[var(--radius)] border border-[var(--color-warn)]/40 bg-[rgba(255,196,0,0.1)] p-4 text-sm text-[var(--color-fg)]">
                  <span className="font-semibold text-[var(--color-warn)]">Race has not started yet.</span>{' '}
                  Invite friends now — the host can start the session when lights go out.
                </p>
              )}

              {liveOnlyMode && (
                <p className="mb-3 rounded-[var(--radius)] border border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] p-4 text-sm text-[var(--color-fg)]">
                  <span className="font-semibold text-[var(--color-accent)]">Race is live.</span> Start the
                  live session whenever your lobby is ready.
                </p>
              )}

              <div className="space-y-2.5">
                {displaySessions.length > 0 ? (
                  displaySessions.map((session) => {
                    const isSelected = String(session.session_key) === selectedSession;
                    const isLive = session.isLive;
                    const isCompleted = session.isCompleted;
                    const isPreRace = session.isPreRace;
                    const isSelectable = isLive || isCompleted;

                    const showAsFeatured = isSelectable || (isPreRace && preRaceOnlyMode);

                    return (
                      <button
                        key={session.session_key}
                        type="button"
                        disabled={!isSelectable}
                        onClick={() => handleSessionClick(session)}
                        className={cn(
                          'w-full rounded-[var(--radius)] border p-4 text-left transition-all duration-[var(--dur-fast)]',
                          isSelected && showAsFeatured
                            ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] shadow-[var(--shadow-accent)]'
                            : 'border-[var(--color-border)] bg-[var(--color-panel)]',
                          showAsFeatured ? 'active:scale-[0.99]' : 'cursor-not-allowed opacity-50'
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-display text-lg font-semibold uppercase leading-tight">
                              {session.location}
                            </p>
                            <p className="mt-0.5 truncate text-sm text-[var(--color-muted-fg)]">
                              {session.session_name} · {session.country_name}
                            </p>
                          </div>
                          <Chip tone={isLive ? 'go' : isCompleted ? 'accent' : isPreRace ? 'warn' : 'neutral'}>
                            {isLive ? 'Live' : isCompleted ? 'Replay' : isPreRace ? 'Soon' : 'Soon'}
                          </Chip>
                        </div>
                        {isSelected && isSelectable && (
                          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-accent)]">
                            Tap again to start →
                          </p>
                        )}
                      </button>
                    );
                  })
                ) : (
                  <p className="rounded-[var(--radius)] border border-dashed border-[var(--color-border)] p-4 text-center text-sm text-[var(--color-muted-fg)]">
                    No race sessions found for this season.
                  </p>
                )}
              </div>
            </>
          ) : preRaceOnlyMode && preRaceSessionInList ? (
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-warn)]/40 bg-[rgba(255,196,0,0.08)] p-8 text-center">
              <p className="font-display text-2xl font-semibold uppercase text-[var(--color-warn)]">
                Race has not started yet
              </p>
              <p className="mt-2 font-display text-lg font-semibold uppercase">
                {preRaceSessionInList.location}
              </p>
              <p className="mt-1 text-sm text-[var(--color-muted-fg)]">
                {preRaceSessionInList.session_name} · {preRaceSessionInList.country_name}
              </p>
              <p className="mt-4 text-sm text-[var(--color-muted-fg)]">
                Invite more friends while you wait — everyone joins automatically when the host starts the race.
              </p>
            </div>
          ) : (
            <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-panel)] p-8 text-center">
              <span className="mx-auto mb-3 block h-8 w-8 animate-spin-slow rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)]" />
              <p className="font-display text-2xl font-semibold uppercase">Waiting for host</p>
              <p className="mt-2 text-sm text-[var(--color-muted-fg)]">
                The host is choosing a session. You&apos;ll drop into the race automatically.
              </p>
            </div>
          )}

          {error && (
            <p className="mt-4 rounded-[var(--radius-sm)] border border-[var(--color-accent)]/50 bg-[var(--color-accent-soft)] px-4 py-3 text-sm font-medium text-[var(--color-accent)]">
              {error}
            </p>
          )}
        </section>
      </div>

      {/* Sticky start bar (private lobby host only) */}
      {isHost && !lobbyState.isPublic && (
        <div className="pad-safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-[var(--color-border)] bg-[var(--color-bg-2)]/90 px-5 pt-3 backdrop-blur">
          <div className="mx-auto max-w-3xl">
            <Button
              onClick={openStartConfirm}
              disabled={isStarting || !canStartSession}
              size="lg"
              className="w-full"
            >
              {isStarting
                ? 'Starting…'
                : canStartSession
                  ? `Start ${selectedSessionInfo?.location ?? 'session'}`
                  : preRaceOnlyMode
                    ? 'Race has not started yet'
                    : 'Select a session'}
            </Button>
          </div>
        </div>
      )}

      <Dialog
        open={Boolean(confirmSession)}
        onClose={() => {
          if (!isStarting) {
            setConfirmSession(null);
          }
        }}
        title="Start session?"
      >
        {confirmSession && (
          <>
            <p className="mt-3 font-display text-xl font-semibold uppercase leading-tight">
              {confirmSession.location}
            </p>
            <p className="mt-1 text-sm text-[var(--color-muted-fg)]">
              {confirmSession.session_name} · {confirmSession.country_name}
            </p>
            <p className="mt-4 text-sm text-[var(--color-muted-fg)]">
              {confirmSession.isLive
                ? 'Everyone joins the live race. Questions appear as the action unfolds.'
                : 'Everyone joins a real-time replay. Watch alongside your F1 TV broadcast — questions appear as the race plays out.'}
            </p>

            <div className="mt-6 flex flex-col gap-2.5">
              <Button
                onClick={() => handleStartGame(String(confirmSession.session_key))}
                disabled={isStarting}
                size="lg"
              >
                {isStarting ? 'Starting…' : 'Lights out'}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmSession(null)} disabled={isStarting}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </main>
  );
}
