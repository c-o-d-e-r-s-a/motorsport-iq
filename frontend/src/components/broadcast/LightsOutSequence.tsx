'use client';

/**
 * Lights Out — cinematic race-start sequence.
 *
 * Five red lights come on one by one, hold, then go out together and the game
 * UI takes over: "IT'S LIGHTS OUT AND AWAY WE GO". Pure theatre, shown once
 * when a race session begins. Tap anywhere to skip. Display-only overlay —
 * gameplay continues underneath regardless.
 *
 * Robustness notes (previous version drifted / stalled):
 *   - Scheduling runs exactly once per mount. Latest-ref pattern keeps the
 *     `onComplete` callback and reduced-motion flag current without letting a
 *     parent re-render restart the timeline.
 *   - Each mount owns its own local timers array, so a Strict-Mode double-mount
 *     can never clear the second run's timers.
 *   - The final hand-off is deferred until after the exit fade so the overlay
 *     leaves the screen on its own, without a hard cut.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { MotionProvider } from '@/components/motion';
import { springSnap } from '@/lib/motion/presets';
import { useReducedMotion } from '@/lib/motion/useReducedMotion';
import { cn } from '@/lib/cn';

const LIGHT_COUNT = 5;
const LIGHT_STEP_MS = 620;
const HOLD_MS = 1100;
const GO_HOLD_MS = 1500;
const EXIT_MS = 450;

type Phase = 'arming' | 'out' | 'done';

interface LightsOutSequenceProps {
  onComplete: () => void;
}

export default function LightsOutSequence({ onComplete }: LightsOutSequenceProps) {
  const reduced = useReducedMotion();
  const [litCount, setLitCount] = useState(0);
  const [phase, setPhase] = useState<Phase>('arming');

  // Latest-ref pattern: mutable pointers to the freshest props/env values
  // without adding them as effect dependencies. Prevents parent re-renders
  // from re-triggering the scheduling effect and restarting the sequence.
  const onCompleteRef = useRef(onComplete);
  const reducedRef = useRef(reduced);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);
  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  // Exposes the same finish path to the tap-to-skip handler as the timeline.
  const finishRef = useRef<() => void>(() => {});

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      // Only clear pending timers; the exit-fade timer added below is intentional.
      timers.forEach(clearTimeout);
      timers.length = 0;
      setPhase('done');
      // Let the overlay fade out before handing control back to the parent.
      timers.push(
        setTimeout(() => {
          onCompleteRef.current();
        }, EXIT_MS)
      );
    };
    finishRef.current = finish;

    if (reducedRef.current) {
      // Reduced motion: skip the choreography, keep a tiny beat so the
      // transition doesn't feel like a bug.
      timers.push(setTimeout(finish, 500));
    } else {
      for (let i = 1; i <= LIGHT_COUNT; i++) {
        timers.push(setTimeout(() => setLitCount(i), i * LIGHT_STEP_MS));
      }
      const outAt = LIGHT_COUNT * LIGHT_STEP_MS + HOLD_MS;
      timers.push(
        setTimeout(() => {
          setLitCount(0);
          setPhase('out');
        }, outAt)
      );
      timers.push(setTimeout(finish, outAt + GO_HOLD_MS));
    }

    return () => {
      done = true;
      timers.forEach(clearTimeout);
      timers.length = 0;
    };
    // Intentionally empty: this timeline should run exactly once per mount,
    // driven by the refs above. Adding deps here reintroduces the restart bug.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSkip = useCallback(() => {
    finishRef.current();
  }, []);

  return (
    <MotionProvider>
      <AnimatePresence>
        {phase !== 'done' && (
          <m.div
            key="lights-out"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: EXIT_MS / 1000, ease: 'easeOut' } }}
            onClick={handleSkip}
            role="presentation"
            className="fixed inset-0 z-[70] flex cursor-pointer flex-col items-center justify-center bg-[var(--color-bg)]/97 backdrop-blur-sm"
          >
            {/* Speed-line texture keeps it on-brand without stealing focus */}
            <div className="speed-lines pointer-events-none absolute inset-0 opacity-60" aria-hidden />

            <p
              className={cn(
                'font-display text-xs font-bold uppercase tracking-[0.34em] transition-colors duration-300',
                phase === 'out' ? 'text-[var(--color-go)]' : 'text-[var(--color-muted-fg)]'
              )}
            >
              {phase === 'out' ? 'Race start' : 'Starting grid'}
            </p>

            {/* Gantry */}
            <div className="mt-7 flex items-center gap-3 sm:gap-4">
              {Array.from({ length: LIGHT_COUNT }).map((_, i) => {
                const on = i < litCount;
                return (
                  <span
                    key={i}
                    className={cn(
                      'h-12 w-12 rounded-full border-2 transition-all duration-150 sm:h-16 sm:w-16',
                      on
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent)] shadow-[0_0_34px_rgba(255,33,20,0.85)]'
                        : 'border-[var(--color-border-strong)] bg-[var(--color-muted)]'
                    )}
                  />
                );
              })}
            </div>

            <div className="mt-9 flex h-20 items-start justify-center px-6 text-center">
              <AnimatePresence mode="wait">
                {phase === 'out' ? (
                  <m.p
                    key="go"
                    initial={{ opacity: 0, scale: 1.5 }}
                    animate={{ opacity: 1, scale: 1, transition: springSnap }}
                    exit={{ opacity: 0 }}
                    className="font-display text-4xl font-black uppercase tracking-tight text-[var(--color-fg)] sm:text-5xl"
                  >
                    It&apos;s lights out
                    <span className="block text-[var(--color-accent)]">and away we go</span>
                  </m.p>
                ) : (
                  <m.p
                    key="wait"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.1 } }}
                    className="font-display text-xl font-semibold uppercase tracking-[0.2em] text-[var(--color-faint-fg)]"
                  >
                    {reduced ? 'Race starting' : 'Watch the lights…'}
                  </m.p>
                )}
              </AnimatePresence>
            </div>

            <p className="absolute bottom-8 text-[0.65rem] font-medium uppercase tracking-[0.2em] text-[var(--color-faint-fg)]">
              Tap to skip
            </p>
          </m.div>
        )}
      </AnimatePresence>
    </MotionProvider>
  );
}
