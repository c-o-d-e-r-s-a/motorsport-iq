'use client';

import { m, usePresence } from 'framer-motion';
import { useEffect } from 'react';
import { cn } from '@/lib/cn';
import { popIn, raceIn, reducedFade, slidePanel } from '@/lib/motion/presets';
import { useReducedMotion } from '@/lib/motion/useReducedMotion';

type CardTone = 'default' | 'muted' | 'elevated';
type CardEnter = 'pop' | 'race-in' | 'slide-panel';

const toneClasses: Record<CardTone, string> = {
  default: 'bg-[var(--color-panel)] text-[var(--color-fg)] border border-[var(--color-border)]',
  muted: 'bg-[var(--color-muted)] text-[var(--color-fg)] border border-[var(--color-border)]',
  elevated:
    'bg-[linear-gradient(180deg,var(--color-elevated),var(--color-panel))] text-[var(--color-fg)] border border-[var(--color-border)] shadow-[var(--shadow)]',
};

const enterVariants = {
  'pop': popIn,
  'race-in': raceIn,
  'slide-panel': slidePanel,
};

interface MotionCardProps extends React.ComponentPropsWithoutRef<typeof m.div> {
  tone?: CardTone;
  enter?: CardEnter;
  children?: React.ReactNode;
}

/**
 * Animated equivalent of ui/Card — same surface classes, plus an entrance
 * (and exit, when inside AnimatePresence). Use for stage-level swaps like
 * question → resolution where the whole card changes identity.
 */
export function MotionCard({ tone = 'elevated', enter = 'pop', className, children, ...props }: MotionCardProps) {
  const reduced = useReducedMotion();
  const [isPresent, safeToRemove] = usePresence();

  useEffect(() => {
    const onVisibilityReturn = () => {
      if (document.visibilityState !== 'visible') return;
      if (!isPresent) {
        safeToRemove?.();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityReturn);
    window.addEventListener('focus', onVisibilityReturn);
    window.addEventListener('pageshow', onVisibilityReturn);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityReturn);
      window.removeEventListener('focus', onVisibilityReturn);
      window.removeEventListener('pageshow', onVisibilityReturn);
    };
  }, [isPresent, safeToRemove]);

  return (
    <m.div
      layout
      variants={reduced ? reducedFade : enterVariants[enter]}
      initial="hidden"
      animate="visible"
      exit="exit"
      className={cn(
        'col-start-1 row-start-1 w-full rounded-[var(--radius)] p-5 md:p-6',
        toneClasses[tone],
        className
      )}
      {...props}
    >
      {children}
    </m.div>
  );
}
