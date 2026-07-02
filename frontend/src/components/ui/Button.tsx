'use client';

import { cn } from '@/lib/cn';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'success' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows an inline spinner and disables the button. */
  loading?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--color-accent)] text-white shadow-[var(--shadow-accent)] hover:bg-[var(--color-accent-hot)] active:translate-y-px',
  secondary:
    'bg-[var(--color-elevated)] text-[var(--color-fg)] border border-[var(--color-border-strong)] hover:border-[var(--color-fg)] active:translate-y-px',
  ghost:
    'bg-transparent text-[var(--color-muted-fg)] hover:text-[var(--color-fg)] hover:bg-[var(--color-muted)] active:translate-y-px',
  success:
    'bg-[var(--color-go)] text-[#04130b] hover:brightness-110 active:translate-y-px',
  danger:
    'bg-[var(--color-danger)] text-white hover:brightness-110 active:translate-y-px',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-10 px-4 text-sm gap-1.5',
  md: 'h-12 px-5 text-[0.95rem] gap-2',
  lg: 'h-14 px-7 text-base gap-2',
};

export default function Button({
  className,
  variant = 'primary',
  size = 'md',
  type = 'button',
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex min-w-[44px] select-none items-center justify-center rounded-[var(--radius-pill)] font-display font-semibold uppercase tracking-wide',
        'transition-[transform,background-color,border-color,filter,box-shadow,opacity] duration-[var(--dur-fast)] ease-[var(--ease-out)]',
        'active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:active:scale-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]',
        sizeClasses[size],
        variantClasses[variant],
        className
      )}
      {...props}
    >
      {loading && (
        <span
          aria-hidden
          className="h-4 w-4 shrink-0 animate-spin-slow rounded-full border-2 border-current/30 border-t-current"
        />
      )}
      {children}
    </button>
  );
}
