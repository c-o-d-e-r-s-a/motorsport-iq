'use client';

import type { LeaderStats } from '@/lib/types';
import { cn } from '@/lib/cn';
import { Card } from '@/components/ui';

interface TireStatsProps {
  leaderStats: LeaderStats | null;
  lapNumber?: number | null;
  highlighted?: boolean;
}

type CompoundDisplayState = 'known' | 'pending' | 'unknown';

function getCompoundDisplayState(
  compound: string | null | undefined,
  lapNumber: number | null
): CompoundDisplayState {
  if (compound?.trim()) {
    return 'known';
  }

  if (lapNumber === null || lapNumber <= 1) {
    return 'pending';
  }

  return 'unknown';
}

function getCompoundConfig(
  compound: string | null | undefined,
  displayState: CompoundDisplayState
): { label: string; color: string; text: string } {
  if (displayState === 'pending') {
    return { label: '—', color: 'var(--color-muted)', text: 'var(--color-muted-fg)' };
  }

  if (displayState === 'unknown') {
    return { label: 'Unknown', color: 'var(--color-muted)', text: 'var(--color-muted-fg)' };
  }

  const normalized = compound?.trim().toUpperCase() ?? '';

  switch (normalized) {
    case 'SOFT':
      return { label: 'Soft', color: '#ff2d2d', text: '#fff' };
    case 'MEDIUM':
      return { label: 'Medium', color: '#ffd400', text: '#1a1500' };
    case 'HARD':
      return { label: 'Hard', color: '#eef0f4', text: '#0a0d12' };
    case 'INTERMEDIATE':
    case 'INTER':
      return { label: 'Inter', color: '#1fd27a', text: '#04130b' };
    case 'WET':
      return { label: 'Wet', color: '#2f7bff', text: '#fff' };
    default:
      return { label: 'Unknown', color: 'var(--color-muted)', text: 'var(--color-muted-fg)' };
  }
}

export default function TireStats({ leaderStats, lapNumber = null, highlighted = false }: TireStatsProps) {
  const displayState = getCompoundDisplayState(leaderStats?.tyreCompound, lapNumber);
  const compound = getCompoundConfig(leaderStats?.tyreCompound, displayState);
  const name = leaderStats?.name ?? 'Awaiting telemetry';
  const team = leaderStats?.team ?? 'No leader yet';
  const tyreAge = leaderStats?.tyreAge ?? 0;
  const tyresCarriedOver =
    lapNumber !== null && lapNumber > 0 && tyreAge > lapNumber;
  const stint =
    leaderStats?.stintNumber !== null && leaderStats?.stintNumber !== undefined
      ? leaderStats.stintNumber
      : '–';

  return (
    <Card
      tone="default"
      className={cn(
        'transition-[box-shadow,border-color] duration-300',
        highlighted && 'border-[var(--color-accent)] shadow-[0_0_0_2px_var(--color-accent-soft)]'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-faint-fg)]">Race leader</p>
          <h3 className="mt-1 truncate font-display text-2xl font-semibold leading-none">{name}</h3>
          <p className="mt-1 truncate text-sm text-[var(--color-muted-fg)]">{team}</p>
        </div>
        <div
          className="flex flex-col items-center justify-center rounded-[var(--radius-sm)] px-3 py-2 text-center"
          style={{ backgroundColor: compound.color, color: compound.text }}
        >
          <span className="text-[0.6rem] font-semibold uppercase tracking-[0.18em] opacity-80">Tyre</span>
          <span className="font-display text-lg font-bold uppercase leading-none">{compound.label}</span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <div className="rounded-[var(--radius-sm)] bg-[var(--color-muted)] p-3 text-center">
          <p className="font-display text-3xl font-bold leading-none">{tyreAge}</p>
          {tyresCarriedOver && (
            <p className="mt-1 text-[0.58rem] leading-tight text-[var(--color-muted-fg)]">
              Carried from previous session
            </p>
          )}
          <p className="mt-1 text-[0.65rem] font-medium uppercase tracking-wide text-[var(--color-faint-fg)]">
            tyre age
          </p>
        </div>
        <div className="rounded-[var(--radius-sm)] bg-[var(--color-muted)] p-3 text-center">
          <p className="font-display text-3xl font-bold leading-none">{stint}</p>
          <p className="mt-1 text-[0.65rem] font-medium uppercase tracking-wide text-[var(--color-faint-fg)]">stint</p>
        </div>
      </div>
    </Card>
  );
}
