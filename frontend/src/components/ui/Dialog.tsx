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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-[color-mix(in_srgb,var(--color-bg),transparent_20%)] backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'relative z-10 w-full max-w-md border-2 border-[var(--color-border)] bg-[var(--color-panel)] p-6',
          className
        )}
      >
        <h2 id={titleId} className="font-display text-2xl uppercase tracking-tight">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
