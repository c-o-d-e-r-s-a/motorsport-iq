'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSocketClient } from '@/lib/socket';
import { SERVER_EVENTS, type LobbyState, type ServerErrorEvent, type SessionInfo } from '@/lib/types';
import { Button, Card, Dialog, SectionLabel, ThemeToggle } from '@/components/ui';

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
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const [confirmSession, setConfirmSession] = useState<SessionInfo | null>(null);

  const currentUserId = typeof window !== 'undefined' ? localStorage.getItem('msp_user_id') : null;

  useEffect(() => {
    const socket = getSocketClient();
    socket.connect();

    const unsubscribers = [
      socket.on('connected', () => {
        setIsReconnecting(false);
        setConnectionNotice(null);
        if (currentUserId) {
          socket.reconnectLobby(currentUserId);
        }
      }),
      socket.on('disconnected', () => {
        setIsReconnecting(true);
      }),
      socket.on('connection_error', ({ message }: { message: string }) => {
        setIsReconnecting(true);
        setConnectionNotice(message);
      }),
      socket.on(SERVER_EVENTS.LOBBY_STATE, (state: LobbyState) => {
        setLobbyState(state);
        setIsLoading(false);

        if (state.status === 'active') {
          router.push(`/game/${state.code}`);
        }
      }),
      socket.on(SERVER_EVENTS.PLAYER_JOINED, (data: { userId: string; username: string }) => {
        setLobbyState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            players: [...prev.players, { id: data.userId, username: data.username, isHost: false, connected: true }],
          };
        });
      }),
      socket.on(SERVER_EVENTS.PLAYER_LEFT, (data: { userId: string }) => {
        setLobbyState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            players: prev.players.filter((player) => player.id !== data.userId),
          };
        });
      }),
      socket.on(SERVER_EVENTS.PLAYER_DISCONNECTED, (data: { userId: string }) => {
        setLobbyState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            players: prev.players.map((player) =>
              player.id === data.userId ? { ...player, connected: false } : player
            ),
          };
        });
      }),
      socket.on(SERVER_EVENTS.SESSION_STARTED, () => {
        router.push(`/game/${lobbyCode}`);
      }),
      socket.on(SERVER_EVENTS.SESSIONS_LIST, (sessionList: SessionInfo[]) => {
        setSessions(sessionList);
        if (sessionList.length > 0) {
          const liveSession = sessionList.find((session) => session.isLive);
          const firstCompleted = sessionList.find((session) => session.isCompleted);
          const firstPlayable = sessionList.find((session) => session.isLive || session.isCompleted);
          setSelectedSession((current) => {
            if (current && sessionList.some((session) => String(session.session_key) === current)) {
              const stillPlayable = sessionList.some(
                (session) => String(session.session_key) === current && (session.isLive || session.isCompleted)
              );
              if (stillPlayable) return current;
            }
            if (liveSession) return String(liveSession.session_key);
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
          localStorage.removeItem('msp_user_id');
          router.push('/');
          return;
        }

        setError(message);
        setIsStarting(false);
      }),
      socket.on(SERVER_EVENTS.PRESENCE_EXPIRED, () => {
        localStorage.removeItem('msp_user_id');
        router.push('/');
      }),
    ];

    socket.getSessions(selectedYear);

    const userId = localStorage.getItem('msp_user_id');
    if (userId) {
      socket.reconnectLobby(userId);
    }

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [currentUserId, lobbyCode, router, selectedYear]);

  useEffect(() => {
    if (!currentUserId) {
      return;
    }

    const socket = getSocketClient();
    socket.sendPresencePing();
    const interval = window.setInterval(() => {
      socket.sendPresencePing();
    }, 60_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [currentUserId]);

  const handleCopyCode = useCallback(() => {
    navigator.clipboard.writeText(lobbyCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [lobbyCode]);

  const handleLeaveLobby = useCallback(() => {
    localStorage.removeItem('msp_user_id');
    getSocketClient().leaveLobby();
    router.push('/');
  }, [router]);

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
    getSocketClient().startSession(lobbyState.id, key, currentUserId);
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

  const isHost = lobbyState?.hostId === currentUserId;
  const selectedSessionInfo = sessions.find((session) => String(session.session_key) === selectedSession) ?? null;
  const canStartSession = Boolean(
    selectedSession && selectedSessionInfo && (selectedSessionInfo.isLive || selectedSessionInfo.isCompleted)
  );

  const openStartConfirm = useCallback(() => {
    if (selectedSessionInfo && canStartSession) {
      setConfirmSession(selectedSessionInfo);
    }
  }, [canStartSession, selectedSessionInfo]);
  const liveSessionInList = sessions.find((session) => session.isLive) ?? null;
  // Backend filters the list down to a single live session when one is in
  // progress (OpenF1 is 401-locked during the live window). We surface a
  // dedicated banner so the host knows historical replays are paused.
  const liveOnlyMode = Boolean(liveSessionInList) && sessions.length === 1;

  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: currentYear - 2022 }, (_, index) => currentYear - index);
  }, []);

  if (isLoading) {
    return (
      <main className="app-shell flex items-center justify-center">
        <p className="font-display text-2xl uppercase tracking-[0.14em]">Loading Lobby…</p>
      </main>
    );
  }

  if (!lobbyState) {
    return (
      <main className="app-shell flex items-center justify-center p-4">
        <Card className="w-full max-w-lg text-center" tone="default">
          <p className="font-display text-4xl uppercase">Lobby Not Found</p>
          <Button onClick={() => router.push('/')} className="mt-6 w-full">
            Back to Home
          </Button>
        </Card>
      </main>
    );
  }

  return (
    <main className="app-shell swiss-noise relative">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8">
        <header className="mb-6 grid gap-4 border-2 border-[var(--color-border)] bg-[var(--color-muted)] p-5 md:grid-cols-[1fr_auto] md:items-start md:p-6">
          <div>
            <SectionLabel index="03" label="Lobby Control" />
            <h1 className="mt-2 font-display text-5xl uppercase tracking-tight md:text-7xl">{lobbyCode}</h1>
            <p className="mt-2 font-body text-sm text-[var(--color-muted-fg)]">
              Host controls race session. Players receive synchronized state updates on reconnect.
            </p>
            {(isReconnecting || connectionNotice) && (
              <p className="mt-3 border-2 border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-display text-[11px] uppercase tracking-[0.14em]">
                {connectionNotice ?? 'Reconnecting to live race server…'}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            {isHost && (
              <Button
                onClick={openStartConfirm}
                disabled={isStarting || !canStartSession}
                size="md"
              >
                {isStarting ? 'Starting Session...' : 'Start Session'}
              </Button>
            )}
            <ThemeToggle />
            <Button variant="secondary" onClick={handleCopyCode}>
              {copied ? 'Code Copied' : 'Copy Code'}
            </Button>
            <Button variant="ghost" onClick={handleLeaveLobby}>
              Leave Lobby
            </Button>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-12">
          <Card className="lg:col-span-5" tone="default">
            <SectionLabel index="03A" label="Players" className="mb-4" />
            <div className="space-y-2">
              {lobbyState.players.map((player) => (
                <div
                  key={player.id}
                  className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-2 border-[var(--color-border)] p-3"
                >
                  <div
                    className="h-3 w-3 border-2 border-[var(--color-border)]"
                    style={{
                      backgroundColor: player.connected ? 'var(--color-accent)' : 'transparent',
                    }}
                  />
                  <p className="font-display text-lg uppercase">
                    {player.username}
                    {player.isHost ? ' · HOST' : ''}
                    {player.id === currentUserId ? ' · YOU' : ''}
                  </p>
                  <p className="font-display text-xs uppercase tracking-[0.15em] text-[var(--color-muted-fg)]">
                    {player.connected ? 'Online' : 'Offline'}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          <Card className="swiss-grid-pattern lg:col-span-7" tone="muted">
            {isHost ? (
              <>
                <SectionLabel index="03B" label="Session Setup" className="mb-4" />
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block font-display text-xs uppercase tracking-[0.2em] text-[var(--color-muted-fg)]">
                      Season Year
                    </span>
                    <select
                      value={selectedYear}
                      onChange={(event) => {
                        setSelectedYear(Number(event.target.value));
                        setSelectedSession('');
                      }}
                      className="h-12 w-full border-2 border-[var(--color-border)] bg-[var(--color-bg)] px-4 font-display text-sm uppercase focus-visible:border-[var(--color-accent)] focus-visible:outline-none"
                    >
                      {years.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-2 block font-display text-xs uppercase tracking-[0.2em] text-[var(--color-muted-fg)]">
                      Race Session
                    </span>
                    <p className="font-body text-sm text-[var(--color-muted-fg)]">
                      {liveOnlyMode
                        ? 'A live race is in progress. Historical replays pause until the chequered flag — only the live session is available right now.'
                        : 'Select a live session during the race window, or a completed session for 10x replay.'}
                    </p>
                  </label>
                </div>

                <div className="mt-4 space-y-3">
                  {sessions.length > 0 ? (
                    sessions.map((session) => {
                      const isSelected = String(session.session_key) === selectedSession;
                      const isLive = session.isLive;
                      const isCompleted = session.isCompleted;
                      const isSelectable = isLive || isCompleted;

                      return (
                        <button
                          key={session.session_key}
                          type="button"
                          disabled={!isSelectable}
                          onClick={() => handleSessionClick(session)}
                          className={`w-full border-2 p-4 text-left transition-colors ${
                            isSelected && isSelectable
                              ? 'border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent),transparent_90%)]'
                              : 'border-[var(--color-border)] bg-[var(--color-bg)]'
                          } ${
                            isSelectable
                              ? 'cursor-pointer hover:border-[var(--color-accent)]'
                              : 'cursor-not-allowed opacity-55'
                          }`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-display text-lg uppercase leading-tight">
                                {session.session_name} · {session.location}
                              </p>
                              <p className="mt-1 font-body text-sm text-[var(--color-muted-fg)]">
                                {session.circuit_short_name}, {session.country_name}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <span className="border-2 border-[var(--color-border)] px-2 py-1 font-display text-[10px] uppercase tracking-[0.18em]">
                                {isLive ? 'Live' : isCompleted ? 'Replay' : 'Upcoming'}
                              </span>
                              <span
                                className={`border-2 px-2 py-1 font-display text-[10px] uppercase tracking-[0.18em] ${
                                  isLive || isCompleted
                                    ? 'border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent),transparent_88%)]'
                                    : 'border-[var(--color-border)]'
                                }`}
                              >
                                {isLive ? 'Live Now' : isCompleted ? 'Replay Ready' : 'Not Started'}
                              </span>
                            </div>
                          </div>
                          <p className="mt-3 font-display text-xs uppercase tracking-[0.14em] text-[var(--color-muted-fg)]">
                            {isLive
                              ? 'This session follows live telemetry. Questions appear only when the server-side trigger engine finds a valid race situation.'
                              : isCompleted
                                ? 'Replay ready. Telemetry replay runs at 10x and triggers AI-written questions from the server question bank.'
                                : 'Unavailable until the session start time. Check back when the session goes live.'}
                          </p>
                          {isSelected && isSelectable && (
                            <p className="mt-2 font-display text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
                              Click again to start
                            </p>
                          )}
                        </button>
                      );
                    })
                  ) : (
                    <p className="border-2 border-[var(--color-border)] bg-[var(--color-bg)] p-3 font-display text-xs uppercase tracking-[0.14em] text-[var(--color-muted-fg)]">
                      No race or sprint sessions found for this season.
                    </p>
                  )}
                </div>

                {selectedSessionInfo && (
                  <p className="mt-4 border-2 border-[var(--color-border)] bg-[var(--color-bg)] p-3 font-display text-xs uppercase tracking-[0.14em] text-[var(--color-muted-fg)]">
                    {selectedSessionInfo.isLive
                      ? 'Live session connects to real-time F1 SignalR telemetry stream. Questions appear when server-side race signals match valid triggers.'
                      : selectedSessionInfo.isCompleted
                        ? 'Historical telemetry replay starts at 10x speed. Questions appear when server-side race signals match the curated question bank, then Groq/Llama rewrites the prompt and explanation.'
                        : 'This session has not started yet and cannot be started.'}
                  </p>
                )}
              </>
            ) : (
              <>
                <SectionLabel index="03B" label="Standby" className="mb-4" />
                <div className="swiss-dots border-2 border-[var(--color-border)] bg-[var(--color-bg)] p-8 text-center">
                  <p className="font-display text-3xl uppercase">Waiting for Host</p>
                  <p className="mt-2 font-body text-sm text-[var(--color-muted-fg)]">
                    Session configuration is controlled by the host.
                  </p>
                </div>
              </>
            )}

            {error && (
              <p className="mt-4 border-2 border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent),transparent_88%)] p-3 font-display text-xs uppercase tracking-[0.14em]">
                {error}
              </p>
            )}
          </Card>
        </section>
      </div>

      <Dialog
        open={Boolean(confirmSession)}
        onClose={() => {
          if (!isStarting) {
            setConfirmSession(null);
          }
        }}
        title="Start Session"
      >
        {confirmSession && (
          <>
            <p className="mt-3 font-display text-lg uppercase leading-tight">
              {confirmSession.session_name} · {confirmSession.location}
            </p>
            <p className="mt-1 font-body text-sm text-[var(--color-muted-fg)]">
              {confirmSession.circuit_short_name}, {confirmSession.country_name}
            </p>
            <p className="mt-4 font-body text-sm text-[var(--color-muted-fg)]">
              {confirmSession.isLive
                ? 'All players will join the live race feed. Questions trigger from real-time telemetry.'
                : 'All players will join a 10x telemetry replay with server-triggered prediction questions.'}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button
                onClick={() => handleStartGame(String(confirmSession.session_key))}
                disabled={isStarting}
              >
                {isStarting ? 'Starting Session...' : 'Start Session'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setConfirmSession(null)}
                disabled={isStarting}
              >
                Cancel
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </main>
  );
}
