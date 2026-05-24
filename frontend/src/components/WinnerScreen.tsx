'use client';

import { useEffect, useState } from 'react';
import type { LeaderboardEntry } from '@/lib/types';
import { Button, Card } from '@/components/ui';
import { cn } from '@/lib/cn';

interface WinnerScreenProps {
  entries: LeaderboardEntry[];
  onBackToLobby: () => void;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function sortEntries(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
    return b.maxStreak - a.maxStreak;
  });
}

export default function WinnerScreen({ entries, onBackToLobby }: WinnerScreenProps) {
  const rankedEntries = sortEntries(entries);
  const podiumSlots = [
    { place: 3 as const, entry: rankedEntries[2] },
    { place: 2 as const, entry: rankedEntries[1] },
    { place: 1 as const, entry: rankedEntries[0] },
  ].filter((slot): slot is { place: 1 | 2 | 3; entry: LeaderboardEntry } => Boolean(slot.entry));
  const remainingEntries = rankedEntries.slice(3);
  const [revealedPlaces, setRevealedPlaces] = useState(() => (prefersReducedMotion() ? 3 : 0));
  const [celebrationActive, setCelebrationActive] = useState(() => prefersReducedMotion());

  useEffect(() => {
    if (prefersReducedMotion()) {
      return;
    }

    const timers = [350, 700, 1050].map((delay, index) => (
      window.setTimeout(() => {
        setRevealedPlaces(index + 1);
      }, delay)
    ));
    
    // Celebration activation timer
    const celebrationTimer = setTimeout(() => {
      setCelebrationActive(true);
    }, 1200);

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      clearTimeout(celebrationTimer);
    };
  }, [entries]);

  return (
    <Card tone="default" className="relative overflow-hidden border-2 border-[var(--color-accent)] p-8 md:p-10">
      {/* Celebration confetti effect */}
      {celebrationActive && (
        <div className="pointer-events-none absolute inset-0">
          <div className="animate-bounce inline-block h-4 w-4 bg-[var(--color-accent)]/20 rounded-full" style={{ left: '10%', bottom: '20%' }}></div>
          <div className="animate-bounce inline-block h-3 w-3 bg-[var(--color-accent)]/15 rounded-full" style={{ left: '20%', bottom: '40%' }}></div>
          <div className="animate-bounce inline-block h-5 w-5 bg-[var(--color-accent)]/25 rounded-full" style={{ left: '30%', bottom: '30%' }}></div>
          <div className="animate-bounce inline-block h-4 w-4 bg-[var(--color-accent)]/20 rounded-full" style={{ left: '40%', bottom: '50%' }}></div>
          <div className="animate-bounce inline-block h-3 w-3 bg-[var(--color-accent)]/15 rounded-full" style={{ left: '50%', bottom: '25%' }}></div>
          <div className="animate-bounce inline-block h-5 w-5 bg-[var(--color-accent)]/25 rounded-full" style={{ left: '60%', bottom: '45%' }}></div>
          <div className="animate-bounce inline-block h-4 w-4 bg-[var(--color-accent)]/20 rounded-full" style={{ left: '70%', bottom: '35%' }}></div>
          <div className="animate-bounce inline-block h-3 w-3 bg-[var(--color-accent)]/15 rounded-full" style={{ left: '80%', bottom: '55%' }}></div>
          <div className="animate-bounce inline-block h-4 w-4 bg-[var(--color-accent)]/20 rounded-full" style={{ left: '90%', bottom: '20%' }}></div>
        </div>
      )}
      <div className="relative">
        <p className="font-display text-xs uppercase tracking-[0.24em] text-[var(--color-muted-fg)]">Race Finished</p>
        <h2 className="mt-3 font-display text-4xl uppercase tracking-tight md:text-6xl">Final Podium</h2>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {podiumSlots.map(({ place, entry }, index) => {
            const revealed = revealedPlaces >= index + 1;
            const isWinner = place === 1;

            return (
              <div
                key={entry.userId}
                className={cn(
                  'relative border-2 border-[var(--color-border)] p-5 text-center transition-all duration-500',
                  isWinner && 'border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent),transparent_88%)]',
                  revealed ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'
                )}
              >
                {isWinner && revealed && (
                  <>
                    <div className="pointer-events-none absolute inset-0 animate-pulse bg-[radial-gradient(circle_at_center,rgba(255,24,1,0.25),transparent_60%)]" />
                    <div className="pointer-events-none absolute inset-x-8 top-4 h-20 animate-bounce rounded-full border border-[rgba(255,255,255,0.18)]" />
                  </>
                )}
                <p className="relative font-display text-xs uppercase tracking-[0.2em] text-[var(--color-muted-fg)]">
                  {place === 1 ? '🥇 1st Place' : place === 2 ? '🥈 2nd Place' : '🥉 3rd Place'}
                </p>
                <p className="relative mt-3 font-display text-3xl uppercase leading-none md:text-4xl">{entry.username}</p>
                <p className="relative mt-4 font-display text-5xl leading-none">{entry.points}</p>
                <p className="relative mt-1 font-display text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-fg)]">
                  pts
                </p>
                
                {/* Add celebration effects for winner */}
                {isWinner && revealed && celebrationActive && (
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="animate-pulse absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,24,1,0.3),transparent_70%)]" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {remainingEntries.length > 0 && (
          <div className="mt-8 border-t-2 border-[var(--color-border)] pt-6">
            <p className="font-display text-xs uppercase tracking-[0.2em] text-[var(--color-muted-fg)]">Full Classification</p>
            <div className="mt-4 space-y-2">
              {remainingEntries.map((entry, index) => (
                <div key={entry.userId} className="grid grid-cols-[40px_1fr_auto] items-center gap-3 border-2 border-[var(--color-border)] p-3">
                  <p className="font-display text-sm uppercase tracking-[0.14em] text-[var(--color-muted-fg)]">#{index + 4}</p>
                  <p className="font-display text-lg uppercase leading-none">{entry.username}</p>
                  <p className="font-display text-2xl leading-none">{entry.points}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 flex justify-center">
          <Button size="lg" onClick={onBackToLobby}>
            Back to Lobby
          </Button>
        </div>
      </div>
    </Card>
  );
}
