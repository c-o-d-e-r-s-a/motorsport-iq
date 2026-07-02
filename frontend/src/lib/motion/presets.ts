/**
 * Motorsport IQ — "Race Night" motion presets.
 *
 * The language in one line: fast in, controlled settle, ceremony only at the podium.
 *
 * Direction is meaningful:
 *   - Horizontal (x / skew)  → race events arriving (question drop, race control strip)
 *   - Radial (scale / pulse) → urgency (countdown red zone, stamps, verdicts)
 *   - Vertical (y rise)      → triumph (podium, points, rank gains)
 *
 * Micro-interactions stay under ~400ms. Reveals stay under ~800ms.
 * Durations/easings mirror the CSS tokens in globals.css (--dur-*, --ease-*).
 */
import type { TargetAndTransition, Transition, Variants } from 'framer-motion';

/* ---- Timing tokens (seconds — mirror --dur-* / --ease-out) ------------- */
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const DUR_FAST = 0.14;
export const DUR = 0.24;
export const DUR_SLOW = 0.42;

/* ---- Springs ------------------------------------------------------------
 * snap   — hard broadcast-graphics arrival (strips, stamps)
 * pop    — playful confirm (buttons, chips, correct answer)
 * settle — weighty glide (cards, podium blocks, leaderboard rows)
 */
export const springSnap: Transition = { type: 'spring', stiffness: 520, damping: 34, mass: 0.8 };
export const springPop: Transition = { type: 'spring', stiffness: 400, damping: 24 };
export const springSettle: Transition = { type: 'spring', stiffness: 230, damping: 28 };

/* ---- Core variants ------------------------------------------------------ */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: DUR, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: DUR_FAST, ease: EASE_OUT } },
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: DUR, ease: EASE_OUT } },
  exit: { opacity: 0, y: 8, transition: { duration: DUR_FAST, ease: EASE_OUT } },
};

export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: { opacity: 1, scale: 1, transition: springPop },
  exit: { opacity: 0, scale: 0.96, transition: { duration: DUR_FAST, ease: EASE_OUT } },
};

/* Question drop — horizontal arrival with a hint of speed skew. */
export const raceIn: Variants = {
  hidden: { opacity: 0, x: -32, skewX: -3 },
  visible: { opacity: 1, x: 0, skewX: 0, transition: springSettle },
  exit: { opacity: 0, x: 24, transition: { duration: DUR_FAST, ease: EASE_OUT } },
};

/* Race-control strip — snaps in from the left like a timing-screen bulletin. */
export const stripIn: Variants = {
  hidden: { opacity: 0, x: -48 },
  visible: { opacity: 1, x: 0, transition: springSnap },
  exit: { opacity: 0, x: -24, transition: { duration: DUR_FAST, ease: EASE_OUT } },
};

/* Stamp — chips and verdict labels slam down onto the surface. */
export const stampIn: Variants = {
  hidden: { opacity: 0, scale: 1.4 },
  visible: { opacity: 1, scale: 1, transition: springSnap },
  exit: { opacity: 0, transition: { duration: DUR_FAST, ease: EASE_OUT } },
};

/* Podium rise — the only intentionally slow movement in the app. */
export const riseIn: Variants = {
  hidden: { opacity: 0, y: 48 },
  visible: { opacity: 1, y: 0, transition: springSettle },
};

/* Bottom sheet / dialog panel. */
export const slidePanel: Variants = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: springSettle },
  exit: { opacity: 0, y: 40, transition: { duration: DUR, ease: EASE_OUT } },
};

/* Orchestration parent — children animate via their own variants. */
export const staggerContainer = (stagger = 0.06, delayChildren = 0): Variants => ({
  hidden: {},
  visible: { transition: { staggerChildren: stagger, delayChildren } },
  exit: {},
});

/* Reduced-motion replacement: opacity only, no movement, no spring. */
export const reducedFade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.01 } },
  exit: { opacity: 0, transition: { duration: 0.01 } },
};

/* Clone a variant set with a delay on its `visible` state. */
export function withDelay(variants: Variants, delay: number): Variants {
  if (delay <= 0) return variants;
  const visible = variants.visible as TargetAndTransition | undefined;
  if (!visible || typeof visible !== 'object') return variants;
  return {
    ...variants,
    visible: { ...visible, transition: { ...(visible.transition ?? {}), delay } },
  };
}
