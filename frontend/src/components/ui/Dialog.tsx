'use client';

import { useEffect, useId } from 'react';
import { cn } from '@/lib/cn';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}

export default function Dialog({ open, onClose, title, children, className }: DialogProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 animate-fade-in bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'relative z-10 w-full animate-slide-up rounded-t-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-panel)] p-6 pb-[max(1.5rem,var(--safe-bottom))] shadow-[var(--shadow-lg)]',
          'sm:max-w-md sm:rounded-[var(--radius-lg)] sm:pb-6',
          className
        )}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--color-border-strong)] sm:hidden" />
        <h2 id={titleId} className="font-display text-2xl font-semibold uppercase tracking-tight">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
