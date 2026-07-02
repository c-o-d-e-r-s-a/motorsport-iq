import { cn } from '@/lib/cn';

type ChipTone = 'neutral' | 'accent' | 'go' | 'warn' | 'danger' | 'info';

interface ChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone;
  highlighted?: boolean;
  /** Soft repeating pulse ring in the chip's signal color (live/warn states). */
  glow?: boolean;
}

const toneClasses: Record<ChipTone, string> = {
  neutral: 'bg-[var(--color-muted)] text-[var(--color-fg)] border-[var(--color-border)]',
  accent: 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-[var(--color-accent)]/40',
  go: 'bg-[var(--color-go-soft)] text-[var(--color-go)] border-[var(--color-go)]/40',
  warn: 'bg-[rgba(255,196,0,0.14)] text-[var(--color-warn)] border-[var(--color-warn)]/40',
  danger: 'bg-[rgba(255,59,59,0.14)] text-[var(--color-danger)] border-[var(--color-danger)]/40',
  info: 'bg-[rgba(61,139,255,0.14)] text-[var(--color-info)] border-[var(--color-info)]/40',
};

const glowClasses: Partial<Record<ChipTone, string>> = {
  go: 'animate-pulse-ring-go',
  warn: 'animate-pulse-ring-warn',
  accent: 'animate-pulse-ring',
  danger: 'animate-pulse-ring',
};

export default function Chip({ tone = 'neutral', highlighted, glow, className, ...props }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-pill)] border px-3 py-1 text-xs font-semibold uppercase tracking-wide',
        toneClasses[tone],
        highlighted && 'ring-2 ring-[var(--color-accent)] ring-offset-1 ring-offset-[var(--color-bg)]',
        glow && glowClasses[tone],
        className
      )}
      {...props}
    />
  );
}
