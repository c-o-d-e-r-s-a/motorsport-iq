'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { Card } from '@/components/ui';
import { MotionProvider } from '@/components/motion';
import { springSettle } from '@/lib/motion/presets';
import { useReducedMotion } from '@/lib/motion/useReducedMotion';
import type { LeaderboardEntry, PlayerState } from '@/lib/types';
import { cn } from '@/lib/cn';

interface LeaderboardProps {
  entries: LeaderboardEntry[];
  currentUserId?: string;
  maxEntries?: number;
  players?: PlayerState[];
  /** Display-only rank movement since the last update (positive = moved up). */
  rankDeltas?: Record<string, number>;
}

const RANK_ACCENT = ['#ffd400', '#cfd6e0', '#d98a4a'];
const GAIN_FLASH_MS = 1400;

export default function Leaderboard({
  entries,
  currentUserId,
  maxEntries = 10,
  players,
  rankDeltas,
}: LeaderboardProps) {
  const reduced = useReducedMotion();

  // Display-only: diff points against the previous update to float a +N flash.
  // Server remains the sole authority on scores — this only reads them.
  const prevPointsRef = useRef<Map<string, number>>(new Map());
  const gainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [gains, setGains] = useState<Record<string, number>>({});

  useEffect(() => {
    const next: Record<string, number> = {};
    for (const entry of entries) {
      const prev = prevPointsRef.current.get(entry.userId);
      if (prev !== undefined && entry.points > prev) {
        next[entry.userId] = entry.points - prev;
      }
      prevPointsRef.current.set(entry.userId, entry.points);
    }
    // The entries prop is re-created on unrelated parent renders, so the hide
    // timer lives in a ref rather than the effect cleanup — otherwise a
    // re-render could cancel it and leave a stale +N on screen.
    if (Object.keys(next).length === 0) {
      return;
    }
    setGains(next);
    if (gainTimerRef.current) {
      clearTimeout(gainTimerRef.current);
    }
    gainTimerRef.current = setTimeout(() => setGains({}), GAIN_FLASH_MS);
  }, [entries]);

  useEffect(() => () => {
    if (gainTimerRef.current) {
      clearTimeout(gainTimerRef.current);
    }
  }, []);

  const sortedEntries = [...entries]
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
      return b.maxStreak - a.maxStreak;
    })
    .slice(0, maxEntries);

  return (
    <MotionProvider>
      <Card tone="default" className="h-full">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl font-semibold uppercase tracking-tight">Leaderboard</h3>
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-faint-fg)]">
            {sortedEntries.length} {sortedEntries.length === 1 ? 'driver' : 'drivers'}
          </span>
        </div>

        {sortedEntries.length === 0 ? (
          <p className="mt-4 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)] p-5 text-center text-sm text-[var(--color-muted-fg)]">
            No scores yet — answer a question to get on the board.
          </p>
        ) : (
          <ol className="mt-3 space-y-1.5">
            {sortedEntries.map((entry, index) => {
              const rank = index + 1;
              const isCurrentUser = entry.userId === currentUserId;
              const medal = rank <= 3 ? RANK_ACCENT[rank - 1] : null;
              const gain = gains[entry.userId];

              const player = players?.find((p) => p.id === entry.userId);
              const joinedAtLap = player?.joinedAtLap ?? entry.joinedAtLap;
              const showJoinedBadge = joinedAtLap != null && joinedAtLap > 1;
              const rankDelta = rankDeltas?.[entry.userId] ?? 0;

              return (
                <m.li
                  layout
                  transition={reduced ? { duration: 0 } : springSettle}
                  key={entry.userId}
                  className={cn(
                    'relative flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 transition-colors',
                    isCurrentUser
                      ? 'bg-[var(--color-accent-soft)] ring-1 ring-[var(--color-accent)]/50'
                      : 'bg-[var(--color-muted)]',
                    isCurrentUser && gain !== undefined && !reduced && 'animate-confirm'
                  )}
                >
                  <span className="flex shrink-0 items-center gap-1">
                    <span
                      className="flex h-7 w-7 items-center justify-center rounded-full font-display text-sm font-bold"
                      style={
                        medal
                          ? { backgroundColor: medal, color: '#0a0d12' }
                          : { color: 'var(--color-faint-fg)' }
                      }
                    >
                      {rank}
                    </span>
                    <AnimatePresence>
                      {rankDelta !== 0 && (
                        <m.span
                          key={`delta-${rankDelta}`}
                          initial={reduced ? { opacity: 1 } : { opacity: 0, y: rankDelta > 0 ? 5 : -5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={reduced ? { duration: 0.01 } : springSettle}
                          className={cn(
                            'font-display text-[0.7rem] font-bold leading-none',
                            rankDelta > 0 ? 'text-[var(--color-go)]' : 'text-[var(--color-danger)]'
                          )}
                          aria-label={rankDelta > 0 ? `Up ${rankDelta}` : `Down ${-rankDelta}`}
                        >
                          {rankDelta > 0 ? `▲${rankDelta}` : `▼${-rankDelta}`}
                        </m.span>
                      )}
                    </AnimatePresence>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-base font-semibold uppercase leading-tight lg:truncate-none lg:whitespace-normal">
                      {entry.username}
                      {isCurrentUser && <span className="ml-1.5 text-[var(--color-accent)]">· you</span>}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <p className="text-xs text-[var(--color-muted-fg)]">
                        {entry.accuracy.toFixed(0)}% accuracy
                        {entry.streak > 1 ? ` · ${entry.streak} streak` : ''}
                      </p>
                      {showJoinedBadge && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-faint-fg)]">
                          · Joined lap {joinedAtLap}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="relative shrink-0 text-right">
                    <AnimatePresence>
                      {gain && (
                        <m.span
                          key={`gain-${entry.points}`}
                          initial={reduced ? { opacity: 1 } : { opacity: 0, y: 4 }}
                          animate={{ opacity: [0, 1, 1, 0], y: reduced ? 0 : -16 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: reduced ? 0.01 : GAIN_FLASH_MS / 1000, times: [0, 0.15, 0.7, 1] }}
                          className="pointer-events-none absolute -top-4 right-0 font-display text-sm font-bold text-[var(--color-go)]"
                          aria-hidden
                        >
                          +{gain}
                        </m.span>
                      )}
                    </AnimatePresence>
                    <span className="font-display text-xl font-bold leading-none">{entry.points}</span>
                    <span className="ml-1 text-[0.65rem] font-medium uppercase text-[var(--color-faint-fg)]">pts</span>
                  </div>
                </m.li>
              );
            })}
          </ol>
        )}
      </Card>
    </MotionProvider>
  );
}
