'use client';

/**
 * Timing Tower — broadcast-style live top-3 readout.
 *
 * Built entirely from data the client already receives on every race snapshot
 * (topThree names + leader stats). Rows swap with a spring when the order
 * changes, and a driver new to the top 3 flashes on arrival.
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { Card } from '@/components/ui';
import { MotionProvider } from '@/components/motion';
import { springSettle } from '@/lib/motion/presets';
import { useReducedMotion } from '@/lib/motion/useReducedMotion';
import type { RaceSnapshotEvent } from '@/lib/types';
import { cn } from '@/lib/cn';

interface TimingTowerProps {
  snapshot: RaceSnapshotEvent | null;
  className?: string;
}

const POSITION_STYLE: Record<number, string> = {
  1: 'bg-[var(--color-accent)] text-white',
  2: 'bg-[#cfd6e0] text-[#0a0d12]',
  3: 'bg-[#d98a4a] text-[#0a0d12]',
};

function tyreColor(compound: string | null | undefined): string | null {
  switch (compound?.trim().toUpperCase()) {
    case 'SOFT': return '#ff2d2d';
    case 'MEDIUM': return '#ffd400';
    case 'HARD': return '#eef0f4';
    case 'INTERMEDIATE':
    case 'INTER': return '#1fd27a';
    case 'WET': return '#2f7bff';
    default: return null;
  }
}

const ENTRY_FLASH_MS = 2200;

export default function TimingTower({ snapshot, className }: TimingTowerProps) {
  const reduced = useReducedMotion();
  const topThree = snapshot?.topThree ?? [];

  // Flash drivers that just broke into the top 3.
  const prevNamesRef = useRef<Set<string>>(new Set());
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [flashNames, setFlashNames] = useState<Set<string>>(new Set());

  const namesKey = topThree.join('|');
  useEffect(() => {
    const names = namesKey ? namesKey.split('|') : [];
    const prev = prevNamesRef.current;
    const arrivals = names.filter((name) => prev.size > 0 && !prev.has(name));
    prevNamesRef.current = new Set(names);
    if (arrivals.length === 0) {
      return;
    }
    setFlashNames(new Set(arrivals));
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
    }
    flashTimerRef.current = setTimeout(() => setFlashNames(new Set()), ENTRY_FLASH_MS);
  }, [namesKey]);

  useEffect(() => () => {
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
    }
  }, []);

  if (topThree.length === 0) {
    return null;
  }

  const leaderStats = snapshot?.leaderStats ?? null;
  const leaderTyre = tyreColor(leaderStats?.tyreCompound);
  const p2Gap = leaderStats?.p2Gap;

  return (
    <MotionProvider>
      <Card tone="default" className={cn('p-4 md:p-4', className)}>
        <div className="flex items-center justify-between">
          <h3 className="font-display text-sm font-bold uppercase tracking-[0.18em]">
            Timing tower
          </h3>
          <span className="flex items-center gap-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-faint-fg)]">
            {!reduced && <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-go)] animate-flash" aria-hidden />}
            Live
          </span>
        </div>

        <ol className="mt-3 space-y-1">
          <AnimatePresence initial={false}>
            {topThree.slice(0, 3).map((name, index) => {
              const position = index + 1;
              const isLeader = position === 1;
              const arriving = flashNames.has(name);
              return (
                <m.li
                  layout
                  key={name}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, x: -18 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, x: 18 }}
                  transition={reduced ? { duration: 0.01 } : springSettle}
                  className={cn(
                    'flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 transition-colors duration-500',
                    arriving ? 'bg-[var(--color-accent-soft)]' : 'bg-[var(--color-muted)]'
                  )}
                >
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] font-display text-xs font-black',
                      POSITION_STYLE[position]
                    )}
                  >
                    {position}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-display text-base font-semibold uppercase leading-none tracking-tight">
                    {name}
                  </span>
                  {isLeader ? (
                    <span className="flex shrink-0 items-center gap-1.5">
                      {leaderTyre && (
                        <span
                          className="h-2.5 w-2.5 rounded-full border border-black/30"
                          style={{ backgroundColor: leaderTyre }}
                          title={`${leaderStats?.tyreCompound ?? ''} · ${leaderStats?.tyreAge ?? 0} laps`}
                          aria-label={`Leader tyre: ${leaderStats?.tyreCompound ?? 'unknown'}`}
                        />
                      )}
                      <span className="font-mono text-[0.68rem] font-bold text-[var(--color-faint-fg)]">
                        LEADER
                      </span>
                    </span>
                  ) : position === 2 && p2Gap != null && Number.isFinite(p2Gap) ? (
                    <span className="shrink-0 font-mono text-[0.72rem] font-bold text-[var(--color-muted-fg)]">
                      +{p2Gap.toFixed(1)}s
                    </span>
                  ) : (
                    <span className="shrink-0 font-mono text-[0.72rem] font-bold text-[var(--color-faint-fg)]">
                      INT
                    </span>
                  )}
                </m.li>
              );
            })}
          </AnimatePresence>
        </ol>
      </Card>
    </MotionProvider>
  );
}
