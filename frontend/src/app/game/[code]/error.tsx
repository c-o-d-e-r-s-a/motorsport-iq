'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui';

export default function GameError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[GamePage]', error);
  }, [error]);

  return (
    <main className="app-shell flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-display text-2xl uppercase tracking-tight">Race screen crashed</h1>
      <p className="max-w-md text-sm text-[var(--color-muted-fg)]">
        Something went wrong loading the game. Your lobby may still be active — try reconnecting.
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
