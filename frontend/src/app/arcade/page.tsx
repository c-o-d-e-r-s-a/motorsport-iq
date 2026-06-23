'use client';

import Link from 'next/link';
import { Brand, Chip } from '@/components/ui';
import { PitWallArcade } from '@/components/minigames';

export default function ArcadePage() {
  return (
    <main className="app-bg pad-safe-top pad-safe-bottom relative min-h-dvh px-5 pb-16">
      <div className="speed-lines pointer-events-none absolute inset-x-0 top-0 z-0 h-56 opacity-60" />

      {/* Top bar */}
      <header className="relative z-10 mx-auto flex w-full max-w-2xl items-center justify-between py-5">
        <Brand />
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-faint-fg)] transition-colors hover:text-[var(--color-fg)]"
        >
          <span className="text-base">←</span> Back to play
        </Link>
      </header>

      <div className="relative z-10 mx-auto w-full max-w-2xl">
        {/* Hero */}
        <section className="animate-fade-up pt-4 text-center">
          <div className="mb-4 flex items-center justify-center gap-2">
            <Chip tone="accent">Pit Wall Arcade</Chip>
          </div>
          <h1 className="font-display text-[2.2rem] font-bold uppercase leading-[0.95] tracking-tight sm:text-4xl">
            Four games.
            <br />
            <span className="text-[var(--color-accent)]">No lobby needed.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-[var(--color-muted-fg)]">
            Sharpen your reactions, race instincts, and memory any time. Beat your personal
            bests — saved right on your device.
          </p>
        </section>

        {/* Arcade */}
        <section className="animate-fade-up delay-1 mt-8">
          <PitWallArcade />
        </section>

        {/* CTA back to the real thing */}
        <section className="animate-fade-up delay-2 mt-10 text-center">
          <p className="text-sm text-[var(--color-muted-fg)]">
            Ready for the real race?{' '}
            <Link
              href="/"
              className="font-semibold text-[var(--color-accent)] transition-colors hover:text-[var(--color-accent-hot)]"
            >
              Jump into a lobby
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
