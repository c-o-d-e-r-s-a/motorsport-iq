'use client';

import { cn } from '@/lib/cn';
import type { QuestionCategory, QuestionContext, QuestionContextDriver } from '@/lib/types';

interface QuestionContextPanelProps {
  context: QuestionContext;
  category: QuestionCategory;
  className?: string;
}

function formatCompound(compound: string | null | undefined): { label: string; color: string; text: string } {
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
      return { label: compound?.trim() || 'Unknown', color: 'var(--color-muted)', text: 'var(--color-muted-fg)' };
  }
}

function formatInterval(interval: number | null, rivalName?: string): string {
  if (interval === null) {
    return 'Gap unknown';
  }

  if (interval <= 0.05) {
    return rivalName ? `Side by side with ${rivalName}` : 'Side by side';
  }

  const formatted = interval.toFixed(1);
  return rivalName ? `+${formatted}s to ${rivalName}` : `+${formatted}s to car ahead`;
}

function showTyreStats(_category: QuestionCategory): boolean {
  return true;
}

function showOvertakeMode(category: QuestionCategory): boolean {
  return category === 'OVERTAKE' || category === 'GAP_CLOSING';
}

function showInterval(category: QuestionCategory): boolean {
  return category === 'OVERTAKE' || category === 'GAP_CLOSING' || category === 'FINISH_POSITION';
}

function DriverRow({
  driver,
  category,
  rivalName,
  role,
}: {
  driver: QuestionContextDriver;
  category: QuestionCategory;
  rivalName?: string;
  role?: 'subject' | 'rival';
}) {
  const compound = formatCompound(driver.tyreCompound);
  const showTyres = showTyreStats(category);
  const showOm = showOvertakeMode(category) && driver.overtakeModeArmed;
  const showGap = showInterval(category) && role === 'subject';

  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-muted)]/40 px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-lg font-bold leading-none text-[var(--color-fg)]">
              P{driver.position}
            </span>
            <span className="truncate font-display text-lg font-semibold leading-none text-[var(--color-fg)]">
              {driver.name}
            </span>
            {showOm && (
              <span className="rounded-[var(--radius-pill)] bg-[var(--color-accent-soft)] px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-[0.14em] text-[var(--color-accent)]">
                OM
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-[var(--color-muted-fg)]">{driver.team}</p>
        </div>

        {showTyres && (
          <div
            className="flex shrink-0 flex-col items-center justify-center rounded-[var(--radius-sm)] px-2.5 py-1.5 text-center"
            style={{ backgroundColor: compound.color, color: compound.text }}
          >
            <span className="text-[0.55rem] font-semibold uppercase tracking-[0.16em] opacity-80">Tyre</span>
            <span className="font-display text-sm font-bold uppercase leading-none">{compound.label}</span>
          </div>
        )}
      </div>

      <div className={cn('mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-muted-fg)]')}>
        {showTyres && (
          <>
            <span>
              <span className="font-semibold text-[var(--color-fg)]">{driver.tyreAge}</span> lap tyres
            </span>
            {driver.stintNumber !== null && (
              <span>
                Stint <span className="font-semibold text-[var(--color-fg)]">{driver.stintNumber}</span>
              </span>
            )}
          </>
        )}
        {showGap && (
          <span>{formatInterval(driver.interval, rivalName)}</span>
        )}
        {!showTyres && !showGap && (
          <span>
            P<span className="font-semibold text-[var(--color-fg)]">{driver.position}</span>
          </span>
        )}
      </div>
    </div>
  );
}

export default function QuestionContextPanel({
  context,
  category,
  className,
}: QuestionContextPanelProps) {
  const rivalName = context.driver2?.name;

  return (
    <div className={cn('mt-5 border-t border-[var(--color-border)] pt-5', className)}>
      <p className="mb-3 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-[var(--color-faint-fg)]">
        As of lap {context.triggerLap}
      </p>

      <div className="flex flex-col gap-2">
        <DriverRow
          driver={context.driver1}
          category={category}
          rivalName={rivalName}
          role="subject"
        />

        {context.driver2 && (category === 'OVERTAKE' || category === 'GAP_CLOSING' || category === 'FINISH_POSITION') && (
          <DriverRow
            driver={context.driver2}
            category={category}
            role="rival"
          />
        )}
      </div>
    </div>
  );
}
