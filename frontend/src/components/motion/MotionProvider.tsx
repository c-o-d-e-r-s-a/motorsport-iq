'use client';

import { LazyMotion, domAnimation } from 'framer-motion';

/**
 * Loads the minimal framer-motion animation runtime once per tree.
 * Wrap any screen that uses `m.*` components (all wrappers in this folder
 * use `m.*`, so they must render inside a MotionProvider).
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      {children}
    </LazyMotion>
  );
}
