'use client';

import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Card } from '@/components/ui';
import ReactionLights from './ReactionLights';
import PitStop from './PitStop';
import GridDash from './GridDash';
import TyreMemory from './TyreMemory';
import { ARCADE_ROOT_ATTR } from './keys';

type Metric = 'ms' | 's' | 'count';

interface GameDef {
  id: string;
  storageKey: string;
  name: string;
  tagline: string;
  metric: Metric;
  lowerIsBetter: boolean;
  icon: ReactNode;
  render: () => ReactNode;
}

const GAMES: GameDef[] = [
  {
    id: 'reaction',
    storageKey: 'reaction',
    name: 'Start Lights',
    tagline: 'Test your reaction off the line',
    metric: 'ms',
    lowerIsBetter: true,
    icon: <LightsIcon />,
    render: () => <ReactionLights />,
  },
  {
    id: 'pitstop',
    storageKey: 'pitstop',
    name: 'Pit Stop',
    tagline: 'Nail all four wheels',
    metric: 's',
    lowerIsBetter: true,
    icon: <WrenchIcon />,
    render: () => <PitStop />,
  },
  {
    id: 'griddash',
    storageKey: 'griddash',
    name: 'Grid Dash',
    tagline: 'Overtake without contact',
    metric: 'count',
    lowerIsBetter: false,
    icon: <CarIcon />,
    render: () => <GridDash />,
  },
  {
    id: 'tyrememory',
    storageKey: 'tyrememory',
    name: 'Strategy Recall',
    tagline: 'Remember the tyre order',
    metric: 'count',
    lowerIsBetter: false,
    icon: <TyreIcon />,
    render: () => <TyreMemory />,
  },
];

function readBest(storageKey: string, metric: Metric): string | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(`msq_arcade_${storageKey}`);
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  if (metric === 'ms') return `${value} ms`;
  if (metric === 's') return `${value.toFixed(2)} s`;
  return `${value}`;
}

interface PitWallArcadeProps {
  /** Slim reassurance line shown above the arcade (e.g. waiting status). */
  contextLabel?: string;
  className?: string;
}

export default function PitWallArcade({ contextLabel, className }: PitWallArcadeProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = GAMES.find((g) => g.id === activeId) ?? null;

  return (
    <Card tone="elevated" className={cn('animate-fade-up', className)} {...{ [ARCADE_ROOT_ATTR]: '' }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {active ? (
            <button
              type="button"
              onClick={() => setActiveId(null)}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-pill)] border border-[var(--color-border-strong)] text-[var(--color-muted-fg)] transition-colors hover:border-[var(--color-fg)] hover:text-[var(--color-fg)]"
              aria-label="Back to arcade"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : (
            <span className="checkers inline-flex h-8 w-8 shrink-0 rounded-[var(--radius-sm)] text-[var(--color-muted-fg)]" aria-hidden />
          )}
          <div>
            <h2 className="font-display text-xl font-bold uppercase tracking-wide leading-none">
              {active ? active.name : 'Pit Wall Arcade'}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--color-muted-fg)]">
              {active ? active.tagline : 'Stay sharp between the calls'}
            </p>
          </div>
        </div>
      </div>

      {/* Reassurance strip — race is still being watched */}
      {contextLabel && (
        <div className="mt-4 flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2">
          <span className="relative mt-1 flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-accent)] opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-accent)]" />
          </span>
          <p className="text-xs font-medium leading-snug text-[var(--color-muted-fg)]">{contextLabel}</p>
        </div>
      )}

      {/* Body */}
      <div className="mt-4">
        {active ? (
          active.render()
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {GAMES.map((game) => {
              const best = readBest(game.storageKey, game.metric);
              return (
                <button
                  key={game.id}
                  type="button"
                  onClick={() => setActiveId(game.id)}
                  className="group flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3.5 text-left transition-[transform,border-color,background-color] duration-150 hover:-translate-y-0.5 hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-muted)] active:translate-y-0"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-muted)] text-[var(--color-accent)] transition-colors group-hover:bg-[var(--color-accent-soft)]">
                    {game.icon}
                  </span>
                  <span className="font-display text-base font-bold uppercase leading-none tracking-wide">
                    {game.name}
                  </span>
                  <span className="text-[0.7rem] leading-snug text-[var(--color-muted-fg)]">
                    {game.tagline}
                  </span>
                  <span className="mt-auto pt-1 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--color-faint-fg)]">
                    {best ? `Best ${best}` : 'No record yet'}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

function LightsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="6" cy="12" r="2.4" fill="currentColor" />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" />
      <circle cx="18" cy="12" r="2.4" fill="currentColor" />
    </svg>
  );
}

function WrenchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14.7 6.3a3.7 3.7 0 0 0-4.9 4.4l-5 5a1.6 1.6 0 0 0 2.3 2.3l5-5a3.7 3.7 0 0 0 4.4-4.9l-2.1 2.1-2-.4-.4-2 2.1-2.1Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 14l1.5-4A2 2 0 0 1 7.4 8.7h9.2a2 2 0 0 1 1.9 1.3L20 14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="3" y="14" width="18" height="3.4" rx="1.4" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="7.5" cy="18.5" r="1.4" fill="currentColor" />
      <circle cx="16.5" cy="18.5" r="1.4" fill="currentColor" />
    </svg>
  );
}

function TyreIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3.4" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
