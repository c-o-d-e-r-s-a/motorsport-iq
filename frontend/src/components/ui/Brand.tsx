import { cn } from '@/lib/cn';

interface BrandProps {
  variant?: 'full' | 'mark';
  className?: string;
}

function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      role="img"
      aria-label="Motorsport IQ"
      className={cn('h-10 w-10', className)}
    >
      <rect x="1" y="1" width="46" height="46" rx="12" fill="#0b0e14" stroke="rgba(255,255,255,0.14)" strokeWidth="1.5" />
      {/* speed chevrons */}
      <path d="M11 30 L19 14 L24 14 L16 30 Z" fill="#ff2114" />
      <path d="M20 30 L28 14 L33 14 L25 30 Z" fill="#ff2114" opacity="0.55" />
      {/* apex dot */}
      <circle cx="34.5" cy="17" r="3.4" fill="#f6f8fb" />
    </svg>
  );
}

export default function Brand({ variant = 'full', className }: BrandProps) {
  if (variant === 'mark') {
    return <Mark className={className} />;
  }

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <Mark />
      <div className="leading-none">
        <span className="font-display text-xl font-bold uppercase italic tracking-tight text-[var(--color-fg)]">
          Motorsport
          <span className="text-[var(--color-accent)]">IQ</span>
        </span>
        <span className="mt-0.5 block text-[0.6rem] font-medium uppercase tracking-[0.28em] text-[var(--color-faint-fg)]">
          Live F1 Predictions
        </span>
      </div>
    </div>
  );
}
