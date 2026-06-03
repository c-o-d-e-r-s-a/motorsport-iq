'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui';

export default function LobbyError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[LobbyPage]', error);
  }, [error]);

  return (
    <main className="app-shell flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-display text-2xl uppercase tracking-tight">Lobby crashed</h1>
      <p className="max-w-md text-sm text-[var(--color-muted-fg)]">
        Something went wrong in the waiting room. Try reloading or head back home.
      </p>
      <div className="flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button variant="secondary" onClick={() => { window.location.href = '/'; }}>
          Back home
        </Button>
      </div>
    </main>
  );
}
