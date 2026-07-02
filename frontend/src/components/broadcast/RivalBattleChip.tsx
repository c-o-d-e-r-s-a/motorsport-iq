'use client';

/**
 * Box Box Broadcast — persistent rival read-out.
 *
 * Shows the player you're battling on the leaderboard: the one directly ahead
 * (you're hunting them) or, when you lead, the one chasing you. Pulses amber
 * when the gap is within one correct answer — striking distance.
 */
import { m } from 'framer-motion';
import { cn } from '@/lib/cn';
import { springSettle } from '@/lib/motion/presets';
import { useReducedMotion } from '@/lib/motion/useReducedMotion';
import type { RivalInfo } from '@/lib/useLeaderboardBattles';

/** One correct answer (10) + potential streak bonus = a catchable gap. */
const STRIKING_DISTANCE = 15;

interface RivalBattleChipProps {
  rival: RivalInfo | null;
  className?: string;
}

export default function RivalBattleChip({ rival, className }: RivalBattleChipProps) {
  const reduced = useReducedMotion();

  if (!rival) {
    return null;
  }

  const hunting = rival.mode === 'hunting';
  const inRange = hunting && rival.gap <= STRIKING_DISTANCE;
  const underThreat = !hunting && rival.gap <= STRIKING_DISTANCE;

  return (
    <m.div
      layout
      transition={reduced ? { duration: 0 } : springSettle}
      className={cn(
        'flex items-center gap-2.5 overflow-hidden rounded-[var(--radius-pill)] border px-3 py-1.5',
        hunting
          ? inRange
            ? 'border-[var(--color-warn)]/50 bg-[rgba(255,196,0,0.1)]'
            : 'border-[var(--color-border)] bg-[var(--color-muted)]'
          : underThreat
            ? 'border-[var(--color-warn)]/50 bg-[rgba(255,196,0,0.1)]'
            : 'border-[var(--color-go)]/40 bg-[var(--color-go-soft)]',
        className
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          hunting
            ? inRange
              ? 'bg-[var(--color-warn)]'
              : 'bg-[var(--color-faint-fg)]'
            : underThreat
              ? 'bg-[var(--color-warn)]'
              : 'bg-[var(--color-go)]',
          (inRange || underThreat) && !reduced && 'animate-flash'
        )}
        aria-hidden
      />
      <span className="min-w-0 truncate text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted-fg)]">
        {hunting ? (
          <>
            P{rival.myRank} · Hunting{' '}
            <span className="text-[var(--color-fg)]">{rival.name}</span>
          </>
        ) : (
          <>
            Leading ·{' '}
            <span className="text-[var(--color-fg)]">{rival.name}</span>
            {' '}chasing
          </>
        )}
      </span>
      <span
        className={cn(
          'ml-auto shrink-0 font-display text-sm font-bold leading-none',
          inRange || underThreat ? 'text-[var(--color-warn)]' : 'text-[var(--color-fg)]'
        )}
      >
        {rival.gap === 0 ? 'Level' : hunting ? `−${rival.gap}` : `+${rival.gap}`}
        {rival.gap !== 0 && (
          <span className="ml-0.5 text-[0.6rem] font-semibold uppercase text-[var(--color-faint-fg)]">pts</span>
        )}
      </span>
    </m.div>
  );
}
