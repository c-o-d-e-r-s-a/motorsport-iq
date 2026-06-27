'use client';

import { cn } from '@/lib/cn';
import { useArcadePause } from './ArcadePauseContext';

interface ArcadePauseButtonProps {
  disabled?: boolean;
  className?: string;
}

export default function ArcadePauseButton({ disabled = false, className }: ArcadePauseButtonProps) {
  const { userPaused, toggleUserPaused } = useArcadePause();

  return (
    <button
      type="button"
      onClick={toggleUserPaused}
      disabled={disabled}
      className={cn(
        'h-12 rounded-[var(--radius-pill)] border border-[var(--color-border-strong)] bg-[var(--color-elevated)] font-display text-sm font-bold uppercase tracking-wide transition-colors hover:border-[var(--color-fg)] active:translate-y-px disabled:opacity-45',
        className
      )}
      aria-label={userPaused ? 'Resume game' : 'Pause game'}
    >
      {userPaused ? 'Resume' : 'Pause'}
    </button>
  );
}
