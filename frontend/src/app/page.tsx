'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SERVER_EVENTS, type LobbyState, type SessionInfo } from '@/lib/types';
import { getApiUrl } from '@/lib/api';
import { getSocketClient } from '@/lib/socket';
import { deriveHomeOpenF1Status } from '@/lib/homeStatus';
import {
  filterSessionsForDisplay,
  isPreRacePlayableSession,
  isPreRacePlayableWindow,
} from '@/lib/sessionDisplay';
import { cn } from '@/lib/cn';
import { saveLobbySession } from '@/lib/sessionPersistence';
import { Button, Brand, Input, Chip } from '@/components/ui';
import RaceAlertOptIn from '@/components/RaceAlertOptIn';

async function wakeBackend(): Promise<void> {
  try {
    await fetch(getApiUrl('/health/scaling'), { method: 'GET', cache: 'no-store' });
  } catch {
    // Backend may still be spinning up — socket retries will continue.
  }
}

const STEPS = [
  ['Play solo', 'Jump into a shared lobby with other racers instantly.'],
  ['Play with friends', 'Create a private lobby and share the code.'],
  ['Answer on the clock', 'Live prompts pop up during the race. You get 45 seconds.'],
];

type HomeMode = 'select' | 'solo' | 'friends';

export default function Home() {
  const router = useRouter();
  const [username, setUsername] = useState(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('msp_username') ?? '';
  });
  const [lobbyCode, setLobbyCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const [isWarmingUp, setIsWarmingUp] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const [mode, setMode] = useState<HomeMode>('select');

  // Sessions for solo mode
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [selectedSessionKey, setSelectedSessionKey] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const prevYearRef = useRef(selectedYear);

  const usernameRef = useRef(username);
  useEffect(() => { usernameRef.current = username; }, [username]);

  // Receives the actual userId and sanitized username from the server after join_solo/join_lobby.
  // Needed because the server may silently replace profane names (e.g. "shit" → "Racer_468782"),
  // which would otherwise prevent the LOBBY_STATE handler from finding the player by username.
  const joinedUserIdRef = useRef<string | null>(null);

  const homeStatus = deriveHomeOpenF1Status({
    sessions,
    isLoading: sessionsLoading,
    hasError: false,
    year: selectedYear,
  });

  const displaySessions = useMemo(() => filterSessionsForDisplay(sessions), [sessions]);
  const preRaceSession = displaySessions.find(isPreRacePlayableSession) ?? null;
  const isPreRaceWindow = isPreRacePlayableWindow(sessions);
  const replaySessions = displaySessions.filter((s) => s.isCompleted);
  const canJoinSolo = homeStatus.isLive || isPreRaceWindow || Boolean(selectedSessionKey);

  useEffect(() => {
    const socket = getSocketClient();
    let warmUpTimer: ReturnType<typeof setTimeout> | undefined;

    void wakeBackend().finally(() => {
      socket.connect();
      warmUpTimer = setTimeout(() => {
        if (!socket.isConnected()) setIsWarmingUp(true);
      }, 4000);
    });

    const unsubscribers = [
      socket.on('connected', () => {
        setIsReconnecting(false);
        setConnectionNotice(null);
        setIsWarmingUp(false);
        clearTimeout(warmUpTimer);
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
        // Server confirmed our actual userId and (possibly sanitized) username.
        // Store both immediately so the LOBBY_STATE handler can find the right player
        // even when the username was silently replaced (e.g. profanity filter).
        joinedUserIdRef.current = data.userId;
        localStorage.setItem('msp_username', data.username);
      }),
      socket.on(SERVER_EVENTS.LOBBY_STATE, (state: LobbyState) => {
        setIsLoading(false);

        // Prefer looking up by the userId we received via join_result (handles sanitized usernames).
        // Fall back to matching by the typed username for create_lobby / join_lobby flows.
        const joinedUser = joinedUserIdRef.current
          ? state.players.find((p) => p.id === joinedUserIdRef.current)
          : state.players.find((p) => p.username === usernameRef.current.trim());

        if (joinedUser) {
          // Always save the player's actual (possibly sanitized) username, not what was typed.
          localStorage.setItem('msp_username', joinedUser.username);
          saveLobbySession({
            userId: joinedUser.id,
            username: joinedUser.username,
            lobbyCode: state.code,
            lobbyStatus: state.status === 'waiting' ? 'waiting' : 'active',
          });
        }

        joinedUserIdRef.current = null;

        if (state.status === 'waiting') {
          router.push(`/lobby/${state.code}`);
          return;
        }
        router.push(`/game/${state.code}`);
      }),
      socket.on(SERVER_EVENTS.SESSIONS_LIST, (list: SessionInfo[]) => {
        setSessions(list);
        setSessionsLoading(false);
        // Auto-select: live first, then pre-race, then most recent completed
        const live = list.find((s) => s.isLive);
        const preRace = list.find((s) => s.isPreRace);
        const firstCompleted = [...list].filter((s) => s.isCompleted).sort(
          (a, b) => new Date(b.date_end).getTime() - new Date(a.date_end).getTime()
        )[0];
        const preferred = live ?? preRace ?? firstCompleted;
        if (preferred) {
          setSelectedSessionKey(String(preferred.session_key));
        }
      }),
      socket.on(SERVER_EVENTS.ERROR, ({ message }: { message: string }) => {
        setError(message);
        setIsLoading(false);
        setIsJoining(false);
      }),
    ];

    return () => {
      if (warmUpTimer) clearTimeout(warmUpTimer);
      unsubscribers.forEach((fn) => fn());
    };
  }, [router]);

  // Fetch sessions when entering solo mode or when year changes
  useEffect(() => {
    if (mode !== 'solo') return;
    setSessionsLoading(true);
    const yearChanged = prevYearRef.current !== selectedYear;
    prevYearRef.current = selectedYear;
    if (yearChanged) setSessions([]);
    getSocketClient().getSessions(selectedYear);
  }, [mode, selectedYear]);

  const requireUsername = (): boolean => {
    if (!username.trim()) {
      setError('Enter your driver name first');
      return false;
    }
    setError(null);
    return true;
  };

  const handlePlaySolo = () => {
    if (!requireUsername()) return;
    setMode('solo');
  };

  const handlePlayFriends = () => {
    if (!requireUsername()) return;
    setMode('friends');
  };

  const handleJoinSoloRace = () => {
    if (!requireUsername()) return;
    if (!selectedSessionKey) {
      setError('Please select a session');
      return;
    }
    setError(null);
    setIsLoading(true);
    localStorage.setItem('msp_username', username.trim());
    
    const restoreUserId = typeof window !== 'undefined' 
      ? localStorage.getItem('msp_restore_user_id') 
      : null;
    const restoreLobbyCode = typeof window !== 'undefined'
      ? localStorage.getItem('msp_restore_lobby_code')
      : null;
    
    getSocketClient().joinSolo(username.trim(), selectedSessionKey, {
      restoreUserId: (restoreUserId && restoreLobbyCode) ? restoreUserId : undefined,
    });
  };

  const handleCreateLobby = () => {
    if (!requireUsername()) return;
    setIsLoading(true);
    getSocketClient().createLobby(username.trim());
  };

  const handleJoinLobby = () => {
    if (!requireUsername()) return;
    if (lobbyCode.trim().length !== 6) {
      setError('Lobby code must be 6 characters');
      return;
    }
    setError(null);
    setIsLoading(true);
    setIsJoining(true);
    getSocketClient().joinLobby(lobbyCode.trim().toUpperCase(), username.trim());
  };

  const years = Array.from(
    { length: new Date().getFullYear() - 2022 },
    (_, i) => new Date().getFullYear() - i
  );

  const creating = isLoading && !isJoining;
  const joining = isLoading && isJoining;

  return (
    <main className="app-bg pad-safe-top pad-safe-bottom flex min-h-dvh flex-col px-5 pb-8">
      <div className="speed-lines pointer-events-none absolute inset-x-0 top-0 z-0 h-56 opacity-60" />

      <header className="relative z-10 flex items-center justify-between py-5">
        <Brand />
      </header>

      <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 lg:max-w-5xl lg:flex-row lg:items-center lg:gap-12">
        {/* Hero */}
        <section className="animate-fade-up lg:flex-1">
          <h1 className="font-display text-[2.6rem] font-bold uppercase leading-[0.95] tracking-tight sm:text-5xl lg:text-6xl">
            Predict the race.
            <br />
            <span className="text-[var(--color-accent)]">Beat your mates.</span>
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-[var(--color-muted-fg)]">
            Live Formula 1 prediction game. Join a lobby, call live race moments in 45 seconds,
            and climb the leaderboard as the laps tick down.
          </p>
          <div className="mt-5 max-w-md">
            <RaceAlertOptIn />
          </div>
          <button
            type="button"
            onClick={() => setShowHow((v) => !v)}
            className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-faint-fg)] transition-colors hover:text-[var(--color-fg)]"
          >
            How it works
            <span className={`transition-transform ${showHow ? 'rotate-90' : ''}`}>›</span>
          </button>
          {showHow && (
            <ol className="mt-3 animate-fade-up space-y-2">
              {STEPS.map(([title, copy], i) => (
                <li key={title} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-soft)] font-display text-sm font-bold text-[var(--color-accent)]">
                    {i + 1}
                  </span>
                  <p className="text-sm text-[var(--color-muted-fg)]">
                    <span className="font-semibold text-[var(--color-fg)]">{title}.</span> {copy}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Access card */}
        <section className="animate-fade-up delay-1 surface-elevated relative w-full overflow-hidden rounded-[var(--radius-lg)] p-6 ring-1 ring-[var(--color-border-strong)] sm:p-7 lg:w-[420px]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[var(--color-accent)] via-[var(--color-accent-hot)] to-transparent" />
          <div className="checkers pointer-events-none absolute right-0 top-0 h-10 w-20 text-[var(--color-fg)] opacity-[0.06]" />

          {isWarmingUp && (
            <div className="mb-5 flex items-start gap-3 rounded-[var(--radius-sm)] border border-[var(--color-warn)]/40 bg-[rgba(255,196,0,0.1)] p-3.5">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 animate-flash rounded-full bg-[var(--color-warn)]" />
              <p className="text-sm leading-snug text-[var(--color-muted-fg)]">
                <span className="font-semibold text-[var(--color-fg)]">Waking the server…</span> First
                connection can take 30–60s. Hang tight.
              </p>
            </div>
          )}

          {/* Driver name — always shown */}
          <Input
            id="username"
            label="Driver name"
            labelClassName="font-display font-bold uppercase tracking-[0.16em] text-[var(--color-fg)]"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && mode === 'select') handlePlaySolo();
            }}
            placeholder="e.g. Lewis Hamilton"
            maxLength={20}
            autoComplete="nickname"
          />

          {/* ── Mode: select ──────────────────────────────────────────────── */}
          {mode === 'select' && (
            <div className="mt-4 grid gap-3">
              {/* Play Solo — primary CTA */}
              <button
                type="button"
                onClick={handlePlaySolo}
                disabled={isLoading}
                className="group relative w-full overflow-hidden rounded-[var(--radius)] border border-[var(--color-accent)]/60 bg-[var(--color-accent-soft)] px-5 py-4 text-left transition-all duration-[var(--dur-fast)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-lg font-bold uppercase tracking-tight text-[var(--color-fg)]">
                      Play Solo
                    </p>
                    <p className="mt-0.5 text-sm text-[var(--color-muted-fg)]">
                      Join a shared lobby with other racers
                    </p>
                  </div>
                  <span className="mt-0.5 text-xl text-[var(--color-accent)]">›</span>
                </div>
              </button>

              {/* Play with Friends */}
              <button
                type="button"
                onClick={handlePlayFriends}
                disabled={isLoading}
                className="group relative w-full overflow-hidden rounded-[var(--radius)] border border-[var(--color-border-strong)] bg-[var(--color-panel)] px-5 py-4 text-left transition-all duration-[var(--dur-fast)] hover:border-[var(--color-accent)]/50 active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-lg font-bold uppercase tracking-tight text-[var(--color-fg)]">
                      Play with Friends
                    </p>
                    <p className="mt-0.5 text-sm text-[var(--color-muted-fg)]">
                      Private lobby — share a code with your crew
                    </p>
                  </div>
                  <span className="mt-0.5 text-xl text-[var(--color-muted-fg)]">›</span>
                </div>
              </button>
            </div>
          )}

          {/* ── Mode: solo ────────────────────────────────────────────────── */}
          {mode === 'solo' && (
            <div className="mt-5 animate-fade-up">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setMode('select'); setError(null); }}
                  className="text-sm font-medium text-[var(--color-faint-fg)] transition-colors hover:text-[var(--color-fg)]"
                >
                  ← Back
                </button>
                <span className="text-[var(--color-faint-fg)]">/</span>
                <p className="font-display text-sm font-bold uppercase tracking-wide text-[var(--color-fg)]">
                  Play Solo
                </p>
              </div>

              {/* Live race banner */}
              {homeStatus.isLive && homeStatus.joinable && (
                <div className="mt-4 rounded-[var(--radius)] border border-[var(--color-go)]/40 bg-[var(--color-go-soft)] px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 animate-flash rounded-full bg-[var(--color-go)]" />
                    <p className="text-sm font-semibold text-[var(--color-go)]">Race is live now</p>
                  </div>
                  <p className="mt-0.5 text-sm text-[var(--color-fg)]">{homeStatus.sessionPrimary}</p>
                  <p className="mt-0.5 text-xs text-[var(--color-muted-fg)]">{homeStatus.sessionSecondary}</p>
                </div>
              )}

              {/* Pre-race waiting lobby banner */}
              {!homeStatus.isLive && isPreRaceWindow && preRaceSession && (
                <div className="mt-4 rounded-[var(--radius)] border border-[var(--color-warn)]/40 bg-[rgba(255,196,0,0.1)] px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[var(--color-warn)]">Race has not started yet</p>
                    <Chip tone="warn">Soon</Chip>
                  </div>
                  <p className="mt-1 font-display text-lg font-semibold uppercase text-[var(--color-fg)]">
                    {preRaceSession.location}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--color-muted-fg)]">
                    {preRaceSession.session_name} · {preRaceSession.country_name} · {preRaceSession.year}
                  </p>
                  <p className="mt-2 text-sm text-[var(--color-muted-fg)]">
                    Join the shared lobby now — you&apos;ll drop into the race automatically at lights out.
                  </p>
                </div>
              )}

              {/* Session picker (replay only — hidden during live or pre-race windows) */}
              {!homeStatus.isLive && !isPreRaceWindow && (
                <div className="mt-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-sm font-semibold text-[var(--color-muted-fg)]">Pick a race</p>
                    <select
                      value={selectedYear}
                      onChange={(e) => {
                        setSelectedYear(Number(e.target.value));
                        setSelectedSessionKey('');
                      }}
                      className="h-8 rounded-[var(--radius-pill)] border border-[var(--color-border-strong)] bg-[var(--color-elevated)] px-3 font-display text-xs font-semibold uppercase focus-visible:border-[var(--color-accent)] focus-visible:outline-none"
                    >
                      {years.map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>

                  {sessionsLoading ? (
                    <div className="flex items-center justify-center gap-2 py-6">
                      <span className="h-5 w-5 animate-spin-slow rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)]" />
                      <span className="text-sm text-[var(--color-muted-fg)]">Loading sessions…</span>
                    </div>
                  ) : replaySessions.length === 0 ? (
                    <p className="rounded-[var(--radius)] border border-dashed border-[var(--color-border)] p-4 text-center text-sm text-[var(--color-muted-fg)]">
                      No completed races found for {selectedYear}.
                    </p>
                  ) : (
                    <div className="max-h-[240px] space-y-2 overflow-y-auto pr-1 [scrollbar-width:thin]">
                      {replaySessions.map((session) => {
                        const key = String(session.session_key);
                        const isSelected = key === selectedSessionKey;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setSelectedSessionKey(key)}
                            className={cn(
                              'w-full rounded-[var(--radius)] border px-4 py-3 text-left transition-all duration-[var(--dur-fast)] active:scale-[0.99]',
                              isSelected
                                ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                                : 'border-[var(--color-border)] bg-[var(--color-panel)] hover:border-[var(--color-border-strong)]'
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate font-display text-base font-semibold uppercase leading-tight">
                                {session.location}
                              </p>
                              <Chip tone="accent">Replay</Chip>
                            </div>
                            <p className="mt-0.5 truncate text-xs text-[var(--color-muted-fg)]">
                              {session.session_name} · {session.country_name} · {session.year}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <Button
                onClick={handleJoinSoloRace}
                disabled={isLoading || !canJoinSolo}
                size="lg"
                className="mt-5 w-full text-base font-bold"
              >
                {isLoading
                  ? 'Finding lobby…'
                  : homeStatus.isLive
                    ? 'Join live race'
                    : isPreRaceWindow
                      ? 'Join waiting lobby'
                      : 'Join solo lobby'}
              </Button>
            </div>
          )}

          {/* ── Mode: friends ─────────────────────────────────────────────── */}
          {mode === 'friends' && (
            <div className="mt-5 animate-fade-up">
              <div className="flex items-center gap-2 mb-5">
                <button
                  type="button"
                  onClick={() => { setMode('select'); setError(null); }}
                  className="text-sm font-medium text-[var(--color-faint-fg)] transition-colors hover:text-[var(--color-fg)]"
                >
                  ← Back
                </button>
                <span className="text-[var(--color-faint-fg)]">/</span>
                <p className="font-display text-sm font-bold uppercase tracking-wide text-[var(--color-fg)]">
                  Play with Friends
                </p>
              </div>

              <Button onClick={handleCreateLobby} disabled={creating} size="lg" className="w-full text-base font-bold">
                {creating ? 'Creating…' : 'Create private lobby'}
              </Button>

              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-[var(--color-border-strong)]" />
                <span className="font-display text-xs font-bold uppercase tracking-[0.24em] text-[var(--color-faint-fg)]">
                  or join
                </span>
                <div className="h-px flex-1 bg-[var(--color-border-strong)]" />
              </div>

              <Input
                id="lobbyCode"
                label="Lobby code"
                labelClassName="font-display font-bold uppercase tracking-[0.16em] text-[var(--color-fg)]"
                value={lobbyCode}
                onChange={(e) => setLobbyCode(e.target.value.toUpperCase())}
                placeholder="6-CHAR CODE"
                maxLength={6}
                inputMode="text"
                autoCapitalize="characters"
                className="text-center font-display text-2xl font-bold tracking-[0.4em]"
              />
              <Button
                variant="secondary"
                onClick={handleJoinLobby}
                disabled={joining}
                size="lg"
                className="mt-4 w-full text-base font-bold"
              >
                {joining ? 'Joining…' : 'Join with code'}
              </Button>
            </div>
          )}

          {error && (
            <p className="mt-4 rounded-[var(--radius-sm)] border border-[var(--color-accent)]/50 bg-[var(--color-accent-soft)] px-4 py-3 text-sm font-medium text-[var(--color-accent)]">
              {error}
            </p>
          )}
          {(isReconnecting || connectionNotice) && !error && (
            <p className="mt-4 rounded-[var(--radius-sm)] bg-[var(--color-muted)] px-4 py-3 text-sm text-[var(--color-muted-fg)]">
              {connectionNotice ?? 'Reconnecting to the race server…'}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
