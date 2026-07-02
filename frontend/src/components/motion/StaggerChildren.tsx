'use client';

import { m, type Variants } from 'framer-motion';
import { fadeUp, reducedFade, staggerContainer } from '@/lib/motion/presets';
import { useEntranceControls } from '@/lib/motion/useEntranceControls';
import { useReducedMotion } from '@/lib/motion/useReducedMotion';

interface StaggerChildrenProps extends React.ComponentPropsWithoutRef<typeof m.div> {
  /** Seconds between each child (default 60ms). */
  stagger?: number;
  /** Seconds before the first child starts. */
  delay?: number;
  children?: React.ReactNode;
}

/**
 * Orchestration parent: children declared with <StaggerItem> (or any m.*
 * element using variants) enter one after another. Reduced motion collapses
 * the stagger — everything appears at once.
 */
export function StaggerChildren({ stagger = 0.06, delay = 0, children, ...props }: StaggerChildrenProps) {
  const reduced = useReducedMotion();
  const controls = useEntranceControls();
  const variants = reduced ? reducedFade : staggerContainer(stagger, delay);

  return (
    <m.div variants={variants} initial="hidden" animate={controls} exit="exit" {...props}>
      {children}
    </m.div>
  );
}

interface StaggerItemProps extends React.ComponentPropsWithoutRef<typeof m.div> {
  variants?: Variants;
  children?: React.ReactNode;
}

/** Child of StaggerChildren. Defaults to fadeUp; pass `variants` to override. */
export function StaggerItem({ variants, children, ...props }: StaggerItemProps) {
  const reduced = useReducedMotion();
  return (
    <m.div variants={reduced ? reducedFade : variants ?? fadeUp} {...props}>
      {children}
    </m.div>
  );
}
