'use client';

import { useAnimationControls, usePresence } from 'framer-motion';
import { useEffect } from 'react';
import { useReducedMotion } from './useReducedMotion';

/** Final composited state after any entrance — clears stuck skew/translate. */
const SETTLED_STATE = {
  opacity: 1,
  x: 0,
  y: 0,
  scale: 1,
  skewX: 0,
} as const;

/**
 * Drives mount + visibility-aware entrance animations.
 *
 * Browsers throttle requestAnimationFrame while a tab is hidden, so spring
 * entrances (especially raceIn's skewX) can freeze mid-transition. When the
 * user returns, snap to the settled visible state instantly.
 *
 * Exiting elements inside `AnimatePresence` must NOT be snapped back to
 * visible — that overrides their exit animation, so `safeToRemove` never
 * fires and the outgoing card stays mounted beneath the new one. When we
 * detect `!isPresent`, we complete the removal directly so a question or
 * resolution swap that happened while the tab was hidden lands cleanly.
 */
export function useEntranceControls() {
  const controls = useAnimationControls();
  const reduced = useReducedMotion();
  const [isPresent, safeToRemove] = usePresence();

  useEffect(() => {
    if (!isPresent) return;
    void controls.start('visible');
  }, [controls, isPresent]);

  useEffect(() => {
    const onVisibilityReturn = () => {
      if (document.visibilityState !== 'visible') return;

      if (!isPresent) {
        safeToRemove?.();
        return;
      }

      void controls.start({
        ...SETTLED_STATE,
        transition: { duration: reduced ? 0.01 : 0 },
      });
    };

    document.addEventListener('visibilitychange', onVisibilityReturn);
    window.addEventListener('focus', onVisibilityReturn);
    window.addEventListener('pageshow', onVisibilityReturn);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityReturn);
      window.removeEventListener('focus', onVisibilityReturn);
      window.removeEventListener('pageshow', onVisibilityReturn);
    };
  }, [controls, reduced, isPresent, safeToRemove]);

  return controls;
}
