'use client';

import { m, type Variants } from 'framer-motion';
import { fadeUp, reducedFade } from '@/lib/motion/presets';
import { useEntranceControls } from '@/lib/motion/useEntranceControls';
import { useReducedMotion } from '@/lib/motion/useReducedMotion';

export interface MotionEnterProps extends React.ComponentPropsWithoutRef<typeof m.div> {
  variants?: Variants;
}

/**
 * Generic entrance wrapper — same visibility snap as MotionCard / FadeIn, without
 * card surface styling. Use for lists, podium blocks, player rows, etc.
 */
export function MotionEnter({ variants = fadeUp, children, ...props }: MotionEnterProps) {
  const reduced = useReducedMotion();
  const controls = useEntranceControls();

  return (
    <m.div
      variants={reduced ? reducedFade : variants}
      initial="hidden"
      animate={controls}
      exit="exit"
      {...props}
    >
      {children}
    </m.div>
  );
}
