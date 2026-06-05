'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSocketClient } from '@/lib/socket';
import { SERVER_EVENTS, type LobbyState, type ServerErrorEvent, type SessionInfo } from '@/lib/types';
import { filterSessionsForDisplay } from '@/lib/sessionDisplay';
import { Button, Card, Chip, SectionLabel } from '@/components/ui';
import { cn } from '@/lib/cn';

// Disabled in production builds — this harness must never reach end users.
const DEV_TOOLS_ENABLED = process.env.NODE_ENV !== 'production';

/**
 * Developer-only replay launcher.
 *
 * This page exposes the fast-replay (10×) playback speed used to verify that the
 * live question pipeline works end to end. It is intentionally kept out of the
 * normal user-facing lobby flow, where only real-time (1×) replays are offered,
 * and is blocked entirely in production.
 */
export default function DevReplayPage() {
  const router = useRouter();
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedSession, setSelectedSession] = useState('');
  const [replaySpeed, setReplaySpeed] = useState<1 | 10>(10);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('Connecting to the race server…');

  useEffect(() => {
    if (!DEV_TOOLS_ENABLED) {
      return;
    }

    const socket = getSocketClient();
    socket.connect();

    const unsubscribers = [
      socket.on('connected', () => {
        setStatus('Creating developer lobby…');
        const username = localStorage.getItem('msp_username') || 'Dev';
        socket.createLobby(username);
      }),
      socket.on(SERVER_EVENTS.LOBBY_STATE, (state: LobbyState) => {
        setLobby(state);
        setStatus('');
        const host = state.players.find((player) => player.isHost);
        if (host) {
          localStorage.setItem('msp_user_id', host.id);
          localStorage.setItem('msp_username', host.username);
          localStorage.setItem('msp_lobby_code', state.code);
        }
        if (state.status === 'active') {
          router.push(`/game/${state.code}`);
        }
      }),
      socket.on(SERVER_EVENTS.SESSIONS_LIST, (sessionList: SessionInfo[]) => {
        setSessions(sessionList);
      }),
      socket.on(SERVER_EVENTS.ERROR, ({ message }: ServerErrorEvent) => {
        setError(message);
        setIsStarting(false);
      }),
      socket.on('connection_error', ({ message }: { message: string }) => {
        setError(message);
        setStatus('Connection failed');
      }),
    ];

    socket.startSessionsPolling(selectedYear, 60_000);

    return () => {
      socket.stopSessionsPolling();
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [router, selectedYear]);

  const replaySessions = useMemo(
    () => filterSessionsForDisplay(sessions).filter((session) => session.isCompleted),
    [sessions]
  );

  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: currentYear - 2022 }, (_, index) => currentYear - index);
  }, []);

  const handleStart = useCallback(() => {
    if (!lobby || !selectedSession) {
      setError('Pick a completed session first.');
      return;
    }
    setError(null);
    setIsStarting(true);
    const userId = localStorage.getItem('msp_user_id');
    getSocketClient().startSession(lobby.id, selectedSession, userId, { replaySpeed });
  }, [lobby, selectedSession, replaySpeed]);

  if (!DEV_TOOLS_ENABLED) {
    return (
      <main className="app-bg pad-safe-top flex min-h-dvh items-center justify-center p-5">
        <Card className="w-full max-w-md text-center">
          <SectionLabel index="404" label="Not available" />
          <h1 className="mt-3 font-display text-3xl font-bold uppercase tracking-tight">
            Page not found
          </h1>
          <p className="mt-2 text-sm text-[var(--color-muted-fg)]">
            This developer tool is disabled in production.
          </p>
          <Button onClick={() => router.push('/')} size="lg" className="mt-6 w-full">
            Back to home
          </Button>
        </Card>
      </main>
    );
  }

  return (
    <main className="app-bg pad-safe-top min-h-dvh">
      <div className="mx-auto w-full max-w-2xl px-5 pb-24">
        <header className="py-5">
          <SectionLabel index="DEV" label="Replay test harness" />
          <h1 className="mt-3 font-display text-3xl font-bold uppercase tracking-tight">
            Fast Replay Launcher
          </h1>
          <p className="mt-2 text-sm text-[var(--color-muted-fg)]">
            Developer-only. Start a completed session at fast-forward speed to verify the live
            question pipeline. Users only ever see real-time (1×) replays.
          </p>
          {lobby && (
            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-faint-fg)]">
              Lobby {lobby.code} · {lobby.players.length} player{lobby.players.length === 1 ? '' : 's'}
            </p>
          )}
        </header>

        {status && (
          <Card className="p-6 text-center">
            <span className="mx-auto mb-3 block h-8 w-8 animate-spin-slow rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)]" />
            <p className="text-sm text-[var(--color-muted-fg)]">{status}</p>
          </Card>
        )}

        {!status && (
          <>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-display text-lg font-semibold uppercase tracking-wide">Pick a session</h2>
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
            </div>

            <div className="space-y-2.5">
              {replaySessions.length > 0 ? (
                replaySessions.map((session) => {
                  const key = String(session.session_key);
                  const isSelected = key === selectedSession;
                  return (
                    <button
                      key={session.session_key}
                      type="button"
                      onClick={() => setSelectedSession(key)}
                      className={cn(
                        'w-full rounded-[var(--radius)] border p-4 text-left transition-all duration-[var(--dur-fast)] active:scale-[0.99]',
                        isSelected
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] shadow-[var(--shadow-accent)]'
                          : 'border-[var(--color-border)] bg-[var(--color-panel)]'
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
                        <Chip tone="accent">Replay</Chip>
                      </div>
                    </button>
                  );
                })
              ) : (
                <p className="rounded-[var(--radius)] border border-dashed border-[var(--color-border)] p-4 text-center text-sm text-[var(--color-muted-fg)]">
                  No completed sessions found for {selectedYear}.
                </p>
              )}
            </div>

            <div className="mt-6">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-faint-fg)]">
                Playback speed
              </p>
              <div role="radiogroup" aria-label="Replay playback speed" className="grid grid-cols-2 gap-2">
                {([1, 10] as const).map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    role="radio"
                    aria-checked={replaySpeed === speed}
                    disabled={isStarting}
                    onClick={() => setReplaySpeed(speed)}
                    className={cn(
                      'rounded-[var(--radius)] border p-3.5 text-left transition-all duration-[var(--dur-fast)]',
                      replaySpeed === speed
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] shadow-[var(--shadow-accent)]'
                        : 'border-[var(--color-border)] bg-[var(--color-panel)]',
                      isStarting ? 'cursor-not-allowed opacity-60' : 'active:scale-[0.99]'
                    )}
                  >
                    <p className="font-display text-lg font-bold uppercase leading-none">{speed}×</p>
                    <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-fg)]">
                      {speed === 1 ? 'Real-time' : 'Fast replay'}
                    </p>
                    <p className="mt-1.5 text-[11px] leading-tight text-[var(--color-faint-fg)]">
                      {speed === 1 ? 'Sync with F1 TV broadcast' : 'Full race in ~10 minutes'}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <p className="mt-4 rounded-[var(--radius-sm)] border border-[var(--color-accent)]/50 bg-[var(--color-accent-soft)] px-4 py-3 text-sm font-medium text-[var(--color-accent)]">
                {error}
              </p>
            )}

            <Button
              onClick={handleStart}
              disabled={isStarting || !selectedSession}
              size="lg"
              className="mt-6 w-full"
            >
              {isStarting ? 'Starting…' : `Start ${replaySpeed}× replay`}
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
