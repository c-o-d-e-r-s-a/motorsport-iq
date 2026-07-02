# Motorsport IQ — "Race Night" Motion Language

> Phase 1 deliverable. Live demo at `/dev/motion` (dev sandbox, not linked from production).

---

## The language

**Fast in, controlled settle, ceremony only at the podium.** Everything enters quickly (springs with high stiffness, `--ease-out` curves) and settles with weight rather than bounce — like a broadcast graphic sliding onto an F1 world feed, not a mobile game jelly effect. Micro-interactions stay under 400ms, reveals under 800ms; the podium sequence is the single sanctioned exception (~1.5s total). Direction carries meaning: **horizontal** movement (slide/skew from the left) means *a race event is arriving* — questions, race-control strips; **radial** movement (scale, pulse, glow) means *urgency* — the countdown red zone, verdict stamps; **vertical** rises mean *triumph* — podium blocks, floating points, rank gains. Motion is earned, not constant: when nothing is at stake the screen is still, which is what makes the red zone and the podium land.

**Timing tokens** (mirror `globals.css`): `DUR_FAST 140ms` · `DUR 240ms` · `DUR_SLOW 420ms` · `EASE_OUT cubic-bezier(0.16,1,0.3,1)`.
**Springs**: `springSnap` (520/34 — broadcast strips, stamps) · `springPop` (400/24 — confirms, ticks) · `springSettle` (230/28 — cards, podium, leaderboard rows).

---

## The 3 hero moments

### 01 · Race Control Bulletin — question drop (Tension)

**When:** `question_event` arrives (TRIGGERED → LIVE).
**What:** A red race-control strip snaps in from the left (`stripIn`) with a one-shot broadcast scanline (`.fx-scan`); the question card races in behind it with a hint of speed skew (`raceIn`); the category chip stamps down (`stampIn`); the YES/NO buttons land last so the player reads the question before the call to action arrives. Total ≈ 750ms.
**Why it fits:** It's literally the app's premise — race control has issued a bulletin and you have 45 seconds to call it. The left-to-right cascade mimics F1 timing-screen graphics, and delaying the buttons builds a beat of tension without slowing anyone down (the window timer starts server-side regardless).

### 02 · Red Zone — countdown panic (Urgency)

**When:** The 45s answer window, `≤10s` remaining.
**What:** Above 50% the ring is calm green and *nothing moves* — restraint is the design. Amber phase stays quiet. At 10s: digits gain a heartbeat (`.animate-heartbeat`), each second tick pops in with a spring (`springPop` scale-in on digit change), and the existing `.animate-pulse-ring` fires. At 3s: the card's edge itself glows red (`.animate-edge-glow`). Urgency radiates outward from the number.
**Why it fits:** The countdown is the core game tension and it currently changes only color. A ramp that *escalates in stages* reads like a race engineer's voice getting sharper — and because the first 35 seconds are motionless, the panic phase genuinely registers.

### 03 · Parc Fermé — podium reveal (Triumph)

**When:** Winner screen after chequered flag.
**What:** Headline stamps in; podium blocks rise from below (`riseIn`) in ceremony order **3rd → 2nd → 1st** (~250ms apart) so the winner lands last; one gold sheen sweeps the winning block (`.fx-sheen`); the existing `mq-rise` confetti starts only after the winner has landed; the rest of the field files in with a quiet stagger.
**Why it fits:** Parc fermé is the one moment F1 itself slows down for ceremony. Reversing the reveal order (current code shows 2nd → 1st → 3rd by layout order) creates an actual "who won" beat. Everything reuses the existing podium layout and confetti — this is choreography, not redesign.

---

## Integration status

Phases 2 and 3 are shipped: everything below is live in production code. P0 game loop (game page, QuestionCard, CountdownTimer, Leaderboard, WinnerScreen), P1 pre-race flow (landing, lobby, PreRaceCountdownChip), and P2 primitives (Button `loading` + press scale, Chip `glow`, Dialog spring slide-up).

| Production target | Change |
|---|---|
| `game/[code]/page.tsx` | Wrap the main stage in `MotionProvider` + `AnimatePresence mode="wait"`; question card enters with Hero 01 sequence, resolution card with `popIn` + verdict `stampIn`; connection banners use `stripIn`. State swaps keyed by `instanceId` — reconnection/`lobby_state` hydration renders the same tree, so restores are never blocked (animations are enter-only, never gate data). |
| `QuestionCard.tsx` | `whileTap` scale 0.97 on YES/NO; answered: chosen button `springPop` confirm, other fades to 50%; chip uses `stampIn`. |
| `CountdownTimer.tsx` | Add red-zone digit tick (`AnimatePresence popLayout` on the seconds value), `.animate-heartbeat` at ≤10s, expose an `onCritical`/className hook so the parent card can apply `.animate-edge-glow` at ≤3s. Color thresholds unchanged. |
| `Leaderboard.tsx` | Row reorder via framer-motion `layout` prop with `springSettle` (list is small; debounce not needed unless updates exceed ~2/s); floating `+N` on point gain (adapted `mq-rise`); current-user ring pulses once on personal gain. |
| `WinnerScreen.tsx` | Replace the transition-delay reveal with the Parc Fermé sequence; keep existing confetti, delay its start to after winner lands. |
| `page.tsx` / `lobby/[code]/page.tsx` (P1) | Hero + access-card `StaggerChildren`; player join = `stripIn` + highlight fade, leave = exit collapse via `AnimatePresence`; start-race moment uses the bulletin strip. |
| `ui/Button.tsx`, `ui/Chip.tsx`, `ui/Dialog.tsx` (P2) | `whileTap` press feedback, live-chip glow, `slidePanel` spring on the dialog. |

**Files added in Phase 1:**

- `src/lib/motion/presets.ts` — variants + springs (single source of truth)
- `src/lib/motion/useReducedMotion.ts` — reactive, SSR-safe hook
- `src/components/motion/` — `MotionProvider` (LazyMotion + domAnimation, strict), `FadeIn`, `StaggerChildren`/`StaggerItem`, `MotionCard`
- `globals.css` — new `mq-edge-glow`, `mq-scan`, `mq-heartbeat`, `mq-sheen`, `mq-checker-drift` keyframes + `.animate-edge-glow`, `.animate-heartbeat`, `.fx-scan`, `.fx-sheen` classes (additive; all existing classes untouched)
- `src/app/dev/motion/page.tsx` — this sandbox

**Reduced motion contract:** every framer variant swaps to `reducedFade` (instant opacity), staggers collapse, and looping CSS effects are conditionally not rendered. The global `prefers-reduced-motion` kill-switch in `globals.css` remains the backstop. Game state is always readable from color and copy alone.

**Performance:** `transform`/`opacity` only (edge glow uses `box-shadow`, but only for ≤3 seconds on one element); `LazyMotion` + `domAnimation` keeps the framer bundle small; no continuous animations run outside the red zone and the winner screen.

---

## Intentionally NOT done (scope discipline)

- **No production files touched** beyond additive CSS — game page, components, sockets, types all untouched until Phase 2 approval.
- **No particle systems / canvas confetti** — the existing 10-span `mq-rise` confetti is enough; more would be spam.
- **No sound design changes** — existing question/outcome sounds already carry audio feedback.
- **No layout, copy, or color changes** — the countdown thresholds, podium layout, and chip tones are exactly as shipped.
- **No page transitions between routes** — Next.js App Router navigation is left alone; the payoff-to-complexity ratio is poor and it risks delaying `lobby_state` restoration.
- **No animation of the arcade / admin / replay routes** — explicitly out of scope.
- **No always-on ambient background motion** — the carbon background stays still so hero moments own the attention.
