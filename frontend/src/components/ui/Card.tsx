import { cn } from '@/lib/cn';

type CardTone = 'default' | 'muted' | 'elevated' | 'inverse';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: CardTone;
}

const toneClasses: Record<CardTone, string> = {
  default: 'bg-[var(--color-panel)] text-[var(--color-fg)] border border-[var(--color-border)]',
  muted: 'bg-[var(--color-muted)] text-[var(--color-fg)] border border-[var(--color-border)]',
  elevated:
    'bg-[linear-gradient(180deg,var(--color-elevated),var(--color-panel))] text-[var(--color-fg)] border border-[var(--color-border)] shadow-[var(--shadow)]',
  inverse: 'bg-[var(--color-fg)] text-[var(--color-bg)] border border-[var(--color-fg)]',
};

export default function Card({ className, tone = 'default', ...props }: CardProps) {
  return (
    <div
      className={cn('rounded-[var(--radius)] p-5 md:p-6', toneClasses[tone], className)}
      {...props}
    />
  );
}
