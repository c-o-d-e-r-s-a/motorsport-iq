'use client';

import { useState } from 'react';
import { m } from 'framer-motion';
import type { LeaderboardEntry } from '@/lib/types';
import { Button, Card } from '@/components/ui';
import { MotionProvider, MotionEnter } from '@/components/motion';
import { fadeUp, reducedFade, riseIn, stampIn, staggerContainer, withDelay } from '@/lib/motion/presets';
import { useReducedMotion } from '@/lib/motion/useReducedMotion';
import { cn } from '@/lib/cn';

interface WinnerScreenProps {
  entries: LeaderboardEntry[];
  onLeaveLobby: () => void;
  isLeaving?: boolean;
  currentUserId?: string;
  isPublic?: boolean;
}

function sortEntries(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
    return b.maxStreak - a.maxStreak;
  });
}

const PODIUM_HEIGHTS: Record<1 | 2 | 3, string> = {
  1: 'h-28',
  2: 'h-20',
  3: 'h-16',
};
const MEDALS = ['🥇', '🥈', '🥉'];
/* Parc Fermé ceremony order: 3rd → 2nd → 1st, so the winner lands last. */
const PODIUM_DELAY: Record<1 | 2 | 3, number> = { 3: 0.15, 2: 0.4, 1: 0.7 };
/* Confetti and the rest of the field wait for the winner to land. */
const CONFETTI_DELAY_S = 1.0;
const FIELD_DELAY_S = 1.05;

export default function WinnerScreen({ entries, onLeaveLobby, isLeaving, currentUserId, isPublic }: WinnerScreenProps) {
  const reduced = useReducedMotion();
  
  // Public lobbies: only show participants who answered at least one question
  const eligibleEntries = isPublic 
    ? entries.filter((entry) => entry.questionsAnswered >= 1)
    : entries;
  
  const ranked = sortEntries(eligibleEntries);
  const winner = ranked[0];
  // Visual podium order: 2nd, 1st, 3rd
  const podium = [
    { place: 2 as const, entry: ranked[1] },
    { place: 1 as const, entry: ranked[0] },
    { place: 3 as const, entry: ranked[2] },
  ].filter((slot): slot is { place: 1 | 2 | 3; entry: LeaderboardEntry } => Boolean(slot.entry));
  const remaining = ranked.slice(3);

  const [shared, setShared] = useState(false);

  const handleShare = async () => {
    const text = winner
      ? `🏁 ${winner.username} won our Motorsport IQ race night with ${winner.points} pts!`
      : 'Race night on Motorsport IQ!';
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Motorsport IQ', text });
      } else {
        await navigator.clipboard.writeText(text);
        setShared(true);
        setTimeout(() => setShared(false), 2000);
      }
    } catch {
      /* user cancelled */
    }
  };

  return (
    <MotionProvider>
      <Card tone="elevated" className="relative overflow-hidden border-[var(--color-accent)]/40 p-6 md:p-8">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(60%_100%_at_50%_0%,var(--color-accent-soft),transparent)]" />
        {!reduced && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
            {Array.from({ length: 10 }).map((_, i) => (
              <span
                key={i}
                className="absolute top-1/3 h-2 w-2 rounded-[1px]"
                style={{
                  left: `${8 + i * 9}%`,
                  backgroundColor: i % 2 ? 'var(--color-accent)' : 'var(--color-warn)',
                  animation: `mq-rise ${1.6 + (i % 4) * 0.3}s ${CONFETTI_DELAY_S + i * 0.12}s ease-out infinite`,
                }}
              />
            ))}
          </div>
        )}

        <MotionEnter
          variants={reduced ? reducedFade : stampIn}
          className="relative text-center"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--color-accent)]">
            🏁 Chequered Flag
          </p>
          <h2 className="mt-2 font-display text-4xl font-bold uppercase tracking-tight md:text-5xl">
            {winner ? `${winner.username} wins` : 'Race finished'}
          </h2>
        </MotionEnter>

        <div className="relative mt-8 flex items-end justify-center gap-2 sm:gap-4">
          {podium.map(({ place, entry }) => {
            const isWinner = place === 1;
            const mine = entry.userId === currentUserId;
            return (
              <MotionEnter
                key={entry.userId}
                variants={reduced ? reducedFade : withDelay(riseIn, PODIUM_DELAY[place])}
                className="flex w-1/3 max-w-[160px] flex-col items-center"
              >
                <span className="text-2xl">{MEDALS[place - 1]}</span>
                <p className="mt-1 max-w-full truncate text-center font-display text-base font-semibold uppercase leading-tight">
                  {entry.username}
                  {mine && <span className="text-[var(--color-accent)]"> ·you</span>}
                </p>
                <p className="font-display text-2xl font-bold leading-none">{entry.points}</p>
                <div
                  className={cn(
                    'relative mt-2 w-full overflow-hidden rounded-t-[var(--radius-sm)] border-t-2',
                    PODIUM_HEIGHTS[place],
                    isWinner
                      ? 'border-[var(--color-accent)] bg-[linear-gradient(180deg,var(--color-accent-soft),transparent)]'
                      : 'border-[var(--color-border-strong)] bg-[var(--color-muted)]'
                  )}
                >
                  {/* One gold sheen sweeps the winner's block after it lands */}
                  {isWinner && !reduced && <span className="fx-sheen" style={{ animationDelay: '1.1s' }} aria-hidden />}
                </div>
              </MotionEnter>
            );
          })}
        </div>

        {remaining.length > 0 && (
          <div className="relative mt-6 border-t border-[var(--color-border)] pt-4">
            <MotionEnter
              variants={reduced ? reducedFade : staggerContainer(0.08, FIELD_DELAY_S)}
              className="space-y-1.5"
            >
              {remaining.map((entry, index) => (
                <m.div
                  key={entry.userId}
                  variants={reduced ? reducedFade : fadeUp}
                  className="flex items-center gap-3 rounded-[var(--radius-sm)] bg-[var(--color-muted)] px-3 py-2"
                >
                  <span className="w-6 text-center font-display text-sm font-bold text-[var(--color-faint-fg)]">
                    {index + 4}
                  </span>
                  <p className="flex-1 truncate font-display text-base font-semibold uppercase">{entry.username}</p>
                  <span className="font-display text-lg font-bold">{entry.points}</span>
                </m.div>
              ))}
            </MotionEnter>
          </div>
        )}

        <div className="relative mt-7 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
          <Button size="lg" variant="secondary" onClick={handleShare} className="sm:px-8">
            {shared ? 'Copied!' : 'Share result'}
          </Button>
          <Button size="lg" onClick={onLeaveLobby} disabled={isLeaving} className="sm:px-8">
            {isLeaving ? 'Leaving…' : 'Leave lobby'}
          </Button>
        </div>
      </Card>
    </MotionProvider>
  );
}
