'use client';

import type { TrackStatus } from '@/lib/types';
import { cn } from '@/lib/cn';

interface RaceConditionBadgeProps {
  status: TrackStatus;
  highlighted?: boolean;
}

const STATUS_CONFIG: Record<TrackStatus, { label: string; dot: string; text: string }> = {
  GREEN: { label: 'Green Flag', dot: 'var(--color-go)', text: 'var(--color-go)' },
  YELLOW: { label: 'Yellow Flag', dot: 'var(--color-warn)', text: 'var(--color-warn)' },
  SC: { label: 'Safety Car', dot: 'var(--color-warn)', text: 'var(--color-warn)' },
  VSC: { label: 'Virtual SC', dot: 'var(--color-warn)', text: 'var(--color-warn)' },
  RED: { label: 'Red Flag', dot: 'var(--color-danger)', text: 'var(--color-danger)' },
  CHEQUERED: { label: 'Chequered', dot: 'var(--color-fg)', text: 'var(--color-fg)' },
};

export default function RaceConditionBadge({ status, highlighted = false }: RaceConditionBadgeProps) {
  const config = STATUS_CONFIG[status] ?? {
    label: `Unknown`,
    dot: 'var(--color-faint-fg)',
    text: 'var(--color-muted-fg)',
  };
  const isLive = status === 'GREEN';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-pill)] border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-1 text-xs font-semibold uppercase tracking-wide',
        highlighted && 'ring-2 ring-[var(--color-accent)] ring-offset-1 ring-offset-[var(--color-bg)]'
      )}
      style={{ color: config.text }}
    >
      {status === 'CHEQUERED' ? (
        <span className="checkers h-2.5 w-2.5 rounded-[2px] text-[var(--color-fg)]" />
      ) : (
        <span
          className={cn('h-2 w-2 rounded-full', isLive && 'animate-flash')}
          style={{ backgroundColor: config.dot }}
        />
      )}
      {config.label}
    </span>
  );
}
