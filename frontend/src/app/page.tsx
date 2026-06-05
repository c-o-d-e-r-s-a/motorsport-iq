'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SERVER_EVENTS, type LobbyState } from '@/lib/types';
import { getSocketClient } from '@/lib/socket';
import { Button, Brand, Input } from '@/components/ui';

const STEPS = [
  ['Create or join', 'Start a private lobby or hop in with a 6-character code.'],
  ['Answer on the clock', 'Live prompts pop up during the race. You get 45 seconds.'],
  ['Climb the board', 'Score on every correct call and battle for the podium.'],
];

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

  useEffect(() => {
    const socket = getSocketClient();
    socket.connect();

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
          localStorage.setItem('msp_lobby_code', state.code);
        }

        if (state.status === 'waiting') {
          router.push(`/lobby/${state.code}`);
          return;
        }

        router.push(`/game/${state.code}`);
      }),
      socket.on(SERVER_EVENTS.ERROR, ({ message }: { message: string }) => {
        setError(message);
        setIsLoading(false);
        setIsJoining(false);
      }),
    ];

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [router, username]);

  const handleCreateLobby = () => {
    if (!username.trim()) {
      setError('Enter your driver name first');
      return;
    }

    setError(null);
    setIsLoading(true);
    getSocketClient().createLobby(username.trim());
  };

  const handleJoinLobby = () => {
    if (!username.trim()) {
      setError('Enter your driver name first');
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
          {/* Accent top stripe + checkered corner */}
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

          <Input
            id="username"
            label="Driver name"
            labelClassName="font-display font-bold uppercase tracking-[0.16em] text-[var(--color-fg)]"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="e.g. Lewis Hamilton"
            maxLength={20}
            autoComplete="nickname"
          />

          <Button onClick={handleCreateLobby} disabled={creating} size="lg" className="mt-4 w-full text-base font-bold">
            {creating ? 'Creating…' : 'Create lobby'}
          </Button>

          <div className="my-6 flex items-center gap-3">
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
            onChange={(event) => setLobbyCode(event.target.value.toUpperCase())}
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
