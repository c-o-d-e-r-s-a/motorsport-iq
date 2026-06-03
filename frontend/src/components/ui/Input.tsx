import { cn } from '@/lib/cn';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  labelClassName?: string;
}

export default function Input({ label, labelClassName, className, id, ...props }: InputProps) {
  return (
    <label className="block w-full" htmlFor={id}>
      {label && (
        <span
          className={cn(
            'mb-2 block text-sm font-medium text-[var(--color-muted-fg)]',
            labelClassName
          )}
        >
          {label}
        </span>
      )}
      <input
        id={id}
        className={cn(
          'h-14 w-full rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg-2)] px-4 text-base text-[var(--color-fg)]',
          'placeholder:text-[var(--color-faint-fg)]',
          'transition-colors duration-[var(--dur-fast)] focus-visible:border-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-soft)]',
          className
        )}
        {...props}
      />
    </label>
  );
}
