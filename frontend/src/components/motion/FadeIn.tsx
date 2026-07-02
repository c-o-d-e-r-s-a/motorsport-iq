'use client';

import { m, type Variants } from 'framer-motion';
import { fadeIn, fadeUp, popIn, raceIn, reducedFade, riseIn, stampIn, stripIn, withDelay } from '@/lib/motion/presets';
import { useEntranceControls } from '@/lib/motion/useEntranceControls';
import { useReducedMotion } from '@/lib/motion/useReducedMotion';
import { cn } from '@/lib/cn';

export type FadeInVariant = 'fade' | 'fade-up' | 'pop' | 'race-in' | 'strip-in' | 'stamp' | 'rise';

const VARIANT_MAP: Record<FadeInVariant, Variants> = {
  'fade': fadeIn,
  'fade-up': fadeUp,
  'pop': popIn,
  'race-in': raceIn,
  'strip-in': stripIn,
  'stamp': stampIn,
  'rise': riseIn,
};

interface FadeInProps extends React.ComponentPropsWithoutRef<typeof m.div> {
  variant?: FadeInVariant;
  /** Seconds. Applied to the enter transition only. */
  delay?: number;
  children?: React.ReactNode;
}

/**
 * Single-element entrance. Works standalone (animates on mount) and inside
 * AnimatePresence (exit variants included). Falls back to an instant fade
 * when the user prefers reduced motion.
 */
export function FadeIn({ variant = 'fade-up', delay = 0, className, children, ...props }: FadeInProps) {
  const reduced = useReducedMotion();
  const controls = useEntranceControls();
  const variants = reduced ? reducedFade : withDelay(VARIANT_MAP[variant], delay);

  return (
    <m.div
      layout
      variants={variants}
      initial="hidden"
      animate={controls}
      exit="exit"
      className={cn('col-start-1 row-start-1 w-full', className)}
      {...props}
    >
      {children}
    </m.div>
  );
}
