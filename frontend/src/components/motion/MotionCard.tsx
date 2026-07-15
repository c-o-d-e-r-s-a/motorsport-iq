'use client';

import { m } from 'framer-motion';
import { cn } from '@/lib/cn';
import { popIn, raceIn, reducedFade, slidePanel } from '@/lib/motion/presets';
import { useEntranceControls } from '@/lib/motion/useEntranceControls';
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
  const controls = useEntranceControls();

  return (
    <m.div
      layout
      variants={reduced ? reducedFade : enterVariants[enter]}
      initial="hidden"
      animate={controls}
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
