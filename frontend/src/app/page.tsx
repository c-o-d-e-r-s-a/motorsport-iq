'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SERVER_EVENTS, type LobbyState, type SessionInfo } from '@/lib/types';
import { getSocketClient } from '@/lib/socket';
import { deriveHomeOpenF1Status } from '@/lib/homeStatus';
import { filterSessionsForDisplay } from '@/lib/sessionDisplay';
import { Button, Card, Input, SectionLabel, ThemeToggle } from '@/components/ui';

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
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [statusYear] = useState<number>(() => new Date().getFullYear());
  const [isStatusLoading, setIsStatusLoading] = useState(true);
  const [statusFetchError, setStatusFetchError] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const [isWarmingUp, setIsWarmingUp] = useState(false);

  useEffect(() => {
    const socket = getSocketClient();
    socket.connect();

    // Show a warming-up notice after 4s if still not connected (Render cold start)
    const warmUpTimer = setTimeout(() => {
      if (!socket.isConnected()) setIsWarmingUp(true);
    }, 4000);

    const unsubscribers = [
      socket.on('connected', () => {
        setIsReconnecting(false);
        setConnectionNotice(null);
        setIsWarmingUp(false);
        clearTimeout(warmUpTimer);
      }),
      socket.on('disconnected', () => {
        setIsReconnecting(true);
      }),
      socket.on('connection_error', ({ message }: { message: string }) => {
        setIsReconnecting(true);
        setConnectionNotice(message);
      }),
      socket.on(SERVER_EVENTS.LOBBY_STATE, (state: LobbyState) => {
        setIsLoading(false);
        localStorage.setItem('msp_username', username);

        const userId = state.players.find((player) => player.username === username)?.id;
        if (userId) {
          localStorage.setItem('msp_user_id', userId);
        }

        if (state.status === 'waiting') {
          router.push(`/lobby/${state.code}`);
          return;
        }

        router.push(`/game/${state.code}`);
      }),
      socket.on(SERVER_EVENTS.SESSIONS_LIST, (sessionList: SessionInfo[]) => {
        setSessions(sessionList);
        setIsStatusLoading(false);
        setStatusFetchError(false);
      }),
      socket.on(SERVER_EVENTS.ERROR, ({ message }: { message: string }) => {
        if (message.toLowerCase().includes('sessions')) {
          setStatusFetchError(true);
          setIsStatusLoading(false);
        }
        setError(message);
        setIsLoading(false);
        setIsJoining(false);
      }),
    ];

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [router, username]);

  useEffect(() => {
    const socket = getSocketClient();
    socket.startSessionsPolling(statusYear, 60_000);

    return () => {
      socket.stopSessionsPolling();
    };
  }, [statusYear]);

  const displaySessions = useMemo(
    () => filterSessionsForDisplay(sessions),
    [sessions]
  );

  const homeStatus = useMemo(
    () =>
      deriveHomeOpenF1Status({
        sessions: displaySessions,
        isLoading: isStatusLoading,
        hasError: statusFetchError,
        year: statusYear,
      }),
    [displaySessions, isStatusLoading, statusFetchError, statusYear]
  );

  const handleCreateLobby = () => {
    if (!username.trim()) {
      setError('Please enter a username');
      return;
    }

    setError(null);
    setIsLoading(true);
    getSocketClient().createLobby(username.trim());
  };

  const handleJoinLobby = () => {
    if (!username.trim()) {
      setError('Please enter a username');
      return;
    }

    if (!lobbyCode.trim()) {
      setError('Please enter a lobby code');
      return;
    }

    if (lobbyCode.trim().length !== 6) {
      setError('Lobby code must be 6 characters');
      return;
    }

    setError(null);
    setIsLoading(true);
    setIsJoining(true);
    getSocketClient().joinLobby(lobbyCode.trim().toUpperCase(), username.trim());
  };

  return (
    <main className="app-shell swiss-noise relative">
      <div className="mx-auto grid min-h-screen w-full max-w-7xl grid-cols-1 gap-5 px-4 py-4 md:px-8 md:py-6 lg:grid-cols-12 lg:gap-6 lg:py-8">
        <section className="swiss-grid-pattern relative overflow-hidden border border-[var(--color-border-strong)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-muted),transparent_8%),var(--color-panel))] px-5 py-6 md:px-8 md:py-8 lg:col-span-7 lg:px-10 lg:py-10">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,var(--color-accent)_0_14%,transparent_14%_20%,var(--color-accent)_20%_33%,transparent_33%_38%,var(--color-accent)_38%_65%,transparent_65%_70%,var(--color-accent)_70%_100%)] opacity-90" />
          <div className="mb-8 flex items-start justify-between gap-4">
            <SectionLabel index="01" label="Race Interface" />
            <ThemeToggle />
          </div>
          <div className="max-w-2xl">
            <Image
              src="/logo-motorsport-iq.svg"
              alt="Motorsport IQ"
              width={376}
              height={120}
              priority
              className="h-auto w-[min(23rem,78vw)]"
            />
            <p className="font-display text-[0.7rem] uppercase tracking-[0.34em] text-[var(--color-muted-fg)]">
              Live Formula 1 Prediction Companion
            </p>
            <p className="mt-5 max-w-xl border-l-[3px] border-[var(--color-accent)] pl-4 font-body text-base leading-7 text-[var(--color-muted-fg)] md:text-lg">
              Join a private lobby, answer live race prompts in 45 seconds, and climb the board as the session unfolds.
            </p>
          </div>

          <div className="mt-10 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <Card tone="default" className="border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-panel),transparent_6%)] p-5 md:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-display text-xs uppercase tracking-[0.24em] text-[var(--color-muted-fg)]">Session Flow</p>
                  <h2 className="mt-2 font-display text-3xl uppercase leading-none text-[var(--color-fg)] md:text-[2.5rem]">
                    Fast In.
                    <br />
                    Live All Race.
                  </h2>
                </div>
                <div className="hidden min-w-[88px] border border-[var(--color-border)] px-3 py-2 text-right md:block">
                  <p className="font-display text-[0.65rem] uppercase tracking-[0.24em] text-[var(--color-muted-fg)]">Window</p>
                  <p className="mt-1 font-display text-3xl leading-none text-[var(--color-accent)]">45s</p>
                </div>
              </div>

              <div className="mt-6 grid gap-3 border-t border-[var(--color-border)] pt-4 md:grid-cols-3">
                {[
                  ['Create or join', 'Private lobby access with a driver name and code.'],
                  ['Answer on the clock', 'Short prediction rounds triggered by live race events.'],
                  ['Resolve at lap end', 'Leaderboard updates after the race state confirms outcomes.'],
                ].map(([title, copy]) => (
                  <div key={title} className="space-y-2">
                    <p className="font-display text-sm uppercase tracking-[0.16em] text-[var(--color-fg)]">{title}</p>
                    <p className="text-sm leading-6 text-[var(--color-muted-fg)]">{copy}</p>
                  </div>
                ))}
              </div>
            </Card>

            <div className="grid gap-4">
              {[
                { label: 'Track Status', value: homeStatus.trackStatusText },
                { label: 'Session Progress', value: homeStatus.progressText },
                {
                  label: 'Leader Proxy (Session)',
                  value: homeStatus.sessionPrimary,
                },
                {
                  label: 'Top-3 Proxy (Session)',
                  value: homeStatus.sessionSecondary,
                },
              ].map((item) => (
                <Card
                  key={item.label}
                  className="border-[var(--color-border)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-panel),transparent_2%),color-mix(in_srgb,var(--color-muted),transparent_24%))] p-4 md:p-5"
                  tone="default"
                >
                  <p className="font-display text-[0.65rem] uppercase tracking-[0.24em] text-[var(--color-muted-fg)]">{item.label}</p>
                  <p className="mt-3 max-w-[16ch] font-display text-[1.65rem] uppercase leading-[0.95] text-[var(--color-fg)]">
                    {item.value}
                  </p>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="lg:col-span-5">
          <Card
            tone="default"
            className="relative h-full overflow-hidden border-[var(--color-border-strong)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-panel),transparent_4%),color-mix(in_srgb,var(--color-muted),transparent_18%))] p-5 md:p-7"
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--color-accent),transparent)] opacity-70" />
            <SectionLabel index="02" label="Lobby Access" className="mb-5" />

            {isWarmingUp && (
              <div className="mb-5 border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-muted),transparent_20%)] p-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-2.5 w-2.5 shrink-0">
                    <span className="absolute inline-flex h-2.5 w-2.5 animate-ping rounded-full bg-[var(--color-accent)] opacity-60" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--color-accent)]" />
                  </span>
                  <div>
                    <p className="font-display text-xs uppercase tracking-[0.2em] text-[var(--color-fg)]">Server Warming Up</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--color-muted-fg)]">
                      The game server is starting from sleep — this usually takes 30–60 seconds on first visit. Hang tight.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-bg),transparent_20%)] p-5 md:p-6">
              <div className="flex items-end justify-between gap-4 border-b border-[var(--color-border)] pb-4">
                <div>
                  <p className="font-display text-[0.7rem] uppercase tracking-[0.3em] text-[var(--color-muted-fg)]">
                    Ready Grid
                  </p>
                  <h2 className="mt-2 font-display text-[2.1rem] uppercase leading-none text-[var(--color-fg)]">
                    Enter Lobby
                  </h2>
                </div>
                <p className="max-w-[12rem] text-right text-xs uppercase tracking-[0.18em] text-[var(--color-muted-fg)]">
                  Name first. Create new or join with code.
                </p>
              </div>

              <div className="mt-5 space-y-4">
              <Input
                id="username"
                label="Driver Name"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Enter your driver name"
                maxLength={20}
              />
                <Button onClick={handleCreateLobby} disabled={isLoading && !isJoining} className="w-full">
                  {isLoading && !isJoining ? 'Creating Lobby...' : 'Create New Lobby'}
                </Button>
              </div>

              <div className="my-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <div className="h-px bg-[var(--color-border)]" />
                <span className="font-display text-[0.7rem] uppercase tracking-[0.28em] text-[var(--color-muted-fg)]">
                  Or Join Existing
                </span>
                <div className="h-px bg-[var(--color-border)]" />
              </div>

              <div className="space-y-4">
              <Input
                id="lobbyCode"
                label="Lobby Code"
                value={lobbyCode}
                onChange={(event) => setLobbyCode(event.target.value.toUpperCase())}
                placeholder="6-character code"
                maxLength={6}
                className="text-center font-display text-2xl tracking-[0.28em]"
              />
              <Button
                variant="secondary"
                onClick={handleJoinLobby}
                disabled={isLoading && isJoining}
                className="w-full"
              >
                {isLoading && isJoining ? 'Joining Lobby...' : 'Join With Code'}
              </Button>
              </div>
            </div>

            {error && (
              <p className="mt-4 border border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent),transparent_90%)] px-4 py-3 text-sm uppercase tracking-[0.12em] text-[var(--color-fg)]">
                {error}
              </p>
            )}
            {(isReconnecting || connectionNotice) && (
              <p className="mt-4 border border-[var(--color-border)] bg-[var(--color-muted)] px-4 py-3 text-sm uppercase tracking-[0.12em] text-[var(--color-fg)]">
                {connectionNotice ?? 'Reconnecting to live race server…'}
              </p>
            )}
          </Card>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {[
                ['Private rooms', 'Invite your group and keep the session focused.'],
                ['Live prompts', 'Questions track the race as the broadcast shifts.'],
                ['Board updates', 'Standings move when the lap officially resolves.'],
              ].map(([title, copy]) => (
                <div key={title} className="border border-[var(--color-border)] px-4 py-4">
                  <p className="font-display text-[0.68rem] uppercase tracking-[0.24em] text-[var(--color-muted-fg)]">{title}</p>
                  <p className="mt-3 text-sm leading-6 text-[var(--color-muted-fg)]">{copy}</p>
                </div>
              ))}
            </div>

            <p className="mt-5 flex items-center justify-between gap-4 border-t border-[var(--color-border)] pt-4 font-display text-[0.68rem] uppercase tracking-[0.24em] text-[var(--color-muted-fg)]">
              <span>Powered by OpenF1 telemetry stream</span>
              <span className="hidden md:inline">Theme toggle available above</span>
            </p>
        </section>
      </div>
    </main>
  );
}
