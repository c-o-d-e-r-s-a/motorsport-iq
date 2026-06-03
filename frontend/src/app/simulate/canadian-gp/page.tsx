'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSocketClient } from '@/lib/socket';
import { SERVER_EVENTS, type LobbyState, type ServerErrorEvent } from '@/lib/types';
import { Card, SectionLabel } from '@/components/ui';
import { DEFAULT_SIMULATION_SESSION_KEY } from '@/lib/simulation';

export default function CanadianGpSimulationPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('Starting Canadian GP simulation…');

  useEffect(() => {
    const socket = getSocketClient();
    socket.connect();

    const unsubscribers = [
      socket.on('connected', () => {
        const username = localStorage.getItem('msp_username') || 'Sim Driver';
        socket.startSimulation({ username, sessionKey: DEFAULT_SIMULATION_SESSION_KEY });
      }),
      socket.on(SERVER_EVENTS.LOBBY_STATE, (state: LobbyState) => {
        const host = state.players.find((player) => player.isHost);
        if (host) {
          localStorage.setItem('msp_user_id', host.id);
        }
        localStorage.setItem('msp_username', host?.username ?? 'Sim Driver');

        if (state.status === 'active') {
          router.push(`/game/${state.code}`);
        }
      }),
      socket.on(SERVER_EVENTS.ERROR, (serverError: ServerErrorEvent) => {
        setError(serverError.message);
        setStatus('Simulation failed');
      }),
      socket.on('connection_error', (payload: { message: string }) => {
        setError(payload.message);
        setStatus('Connection failed');
      }),
    ];

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [router]);

  return (
    <main className="app-shell flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-lg p-8">
        <SectionLabel index="SIM" label="Canadian GP Simulation" />
        <h1 className="mt-3 font-display text-3xl uppercase tracking-tight">
          Live Pipeline Test
        </h1>
        {!error ? (
          <p className="mt-4 font-body text-sm text-[var(--color-muted-fg)]">{status}</p>
        ) : (
          <p className="mt-4 border-2 border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent),transparent_88%)] p-3 font-display text-xs uppercase tracking-[0.14em]">
            {error}
          </p>
        )}
      </Card>
    </main>
  );
}
