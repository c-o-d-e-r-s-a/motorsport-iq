'use client';

/**
 * Box Box Broadcast — F1-world-feed style overtake strip.
 *
 * Plays leaderboard battle events (from useLeaderboardBattles) one at a time
 * as a horizontal race-control bulletin: strip slams in from the left with a
 * scanline, holds, then exits. Lead changes get a gold "NEW LEADER" treatment.
 * Display-only: never touches game state.
 */
import { useEffect } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { cn } from '@/lib/cn';
import { springSnap } from '@/lib/motion/presets';
import { useReducedMotion } from '@/lib/motion/useReducedMotion';
import type { OvertakeBroadcastEvent } from '@/lib/useLeaderboardBattles';

const STRIP_HOLD_MS = 3600;

interface OvertakeBroadcastProps {
  events: OvertakeBroadcastEvent[];
  onDismiss: (id: string) => void;
  currentUserId?: string | null;
}

export default function OvertakeBroadcast({ events, onDismiss, currentUserId }: OvertakeBroadcastProps) {
  const reduced = useReducedMotion();
  const active = events[0] ?? null;

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => onDismiss(active.id), STRIP_HOLD_MS);
    return () => clearTimeout(timer);
  }, [active, onDismiss]);

  return (
    <div
      /* Positioned to clear the sticky HUD (Brand row + RaceHud + rival chip)
         with a small margin. If HUD content changes, adjust here — nothing
         else in the layout is affected. */
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4"
      style={{ top: 'calc(var(--safe-top) + 152px)' }}
      aria-live="polite"
    >
      <AnimatePresence mode="wait">
        {active && (
          <m.div
            key={active.id}
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: -72, skewX: -6 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, x: 0, skewX: 0, transition: springSnap }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: 48, transition: { duration: 0.16 } }}
            className={cn(
              'relative flex w-full max-w-md items-stretch overflow-hidden rounded-[var(--radius-sm)] border shadow-[var(--shadow-lg)]',
              active.isLeadChange
                ? 'border-[var(--color-warn)]/60 bg-[linear-gradient(90deg,rgba(255,196,0,0.2),var(--color-bg-2)_65%)]'
                : 'border-[var(--color-accent)]/50 bg-[linear-gradient(90deg,var(--color-accent-soft),var(--color-bg-2)_65%)]'
            )}
          >
            {!reduced && <span className="fx-scan" aria-hidden />}

            {/* Category tab — solid color block like a timing-screen label */}
            <div
              className={cn(
                'flex shrink-0 items-center px-3 font-display text-xs font-bold uppercase tracking-[0.18em]',
                active.isLeadChange
                  ? 'bg-[var(--color-warn)] text-[#1a1500]'
                  : 'bg-[var(--color-accent)] text-white'
              )}
            >
              {active.isLeadChange ? 'New leader' : 'Overtake'}
            </div>

            <div className="min-w-0 flex-1 px-3.5 py-2.5">
              <p className="truncate font-display text-lg font-bold uppercase leading-tight tracking-tight">
                {active.attackerName}
                {active.attackerId === currentUserId && (
                  <span className="text-[var(--color-accent)]"> · you</span>
                )}
              </p>
              <p className="truncate text-xs font-medium text-[var(--color-muted-fg)]">
                {active.victimName
                  ? `takes P${active.newRank} from ${active.victimName}${active.victimId === currentUserId ? ' (you)' : ''}`
                  : `up to P${active.newRank}`}
              </p>
            </div>

            <div className="flex shrink-0 items-center pr-3.5">
              <span
                className={cn(
                  'font-display text-2xl font-black leading-none',
                  active.isLeadChange ? 'text-[var(--color-warn)]' : 'text-[var(--color-fg)]'
                )}
              >
                P{active.newRank}
              </span>
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
