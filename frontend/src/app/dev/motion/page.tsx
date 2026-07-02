'use client';

/**
 * Motion Lab — /dev/motion
 *
 * Design sandbox for the "Race Night" motion language. Demos the three hero
 * moments on mock UI (real tokens, no sockets, no game logic) plus a gallery
 * of the reusable primitives from src/lib/motion + src/components/motion.
 *
 * Not linked from production navigation. See frontend/MOTION.md for the
 * integration plan.
 */

import { useEffect, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { MotionProvider } from '@/components/motion';
import { cn } from '@/lib/cn';
import {
  fadeUp,
  popIn,
  raceIn,
  reducedFade,
  riseIn,
  springPop,
  springSettle,
  stampIn,
  staggerContainer,
  stripIn,
  withDelay,
} from '@/lib/motion/presets';
import { useReducedMotion } from '@/lib/motion/useReducedMotion';

/* ------------------------------------------------------------------ */
/* Shared sandbox chrome                                                */
/* ------------------------------------------------------------------ */

function ReplayButton({ onClick, label = 'Replay' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-11 min-w-[44px] items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--color-border-strong)] bg-[var(--color-elevated)] px-5 font-display text-sm font-semibold uppercase tracking-wide text-[var(--color-fg)] transition-all duration-[var(--dur-fast)] hover:border-[var(--color-accent)]/60 active:scale-[0.97]"
    >
      <span className="text-[var(--color-accent)]">▶</span>
      {label}
    </button>
  );
}

function SectionHeading({
  kicker,
  title,
  blurb,
}: {
  kicker: string;
  title: string;
  blurb: string;
}) {
  return (
    <div className="max-w-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--color-accent)]">{kicker}</p>
      <h2 className="mt-1.5 font-display text-3xl font-bold uppercase tracking-tight sm:text-4xl">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted-fg)]">{blurb}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* HERO 1 — "Race Control Bulletin" (question drop)                     */
/* ------------------------------------------------------------------ */

function Hero1QuestionDrop({ reduced }: { reduced: boolean }) {
  const [run, setRun] = useState(0);
  const v = (variants: Parameters<typeof withDelay>[0], delay: number) =>
    reduced ? reducedFade : withDelay(variants, delay);

  return (
    <div>
      <div className="mt-5 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-2)] p-4 sm:p-6">
        <AnimatePresence mode="wait">
          <m.div key={run} initial="hidden" animate="visible" exit="exit">
            {/* 1 — Race-control strip snaps in like a timing-screen bulletin */}
            <m.div
              variants={v(stripIn, 0)}
              className="relative flex items-center gap-2.5 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-accent)]/45 bg-[var(--color-accent-soft)] px-3.5 py-2"
            >
              {!reduced && <span className="fx-scan" aria-hidden />}
              <span className={cn('h-2 w-2 rounded-full bg-[var(--color-accent)]', !reduced && 'animate-flash')} />
              <span className="font-display text-sm font-bold uppercase tracking-[0.22em] text-[var(--color-accent)]">
                Race control · Prediction open
              </span>
            </m.div>

            {/* 2 — Card races in from the left with a hint of speed skew */}
            <m.div
              variants={v(raceIn, 0.22)}
              className="mt-4 rounded-[var(--radius)] border border-[var(--color-border)] bg-[linear-gradient(180deg,var(--color-elevated),var(--color-panel))] p-5 shadow-[var(--shadow)] sm:p-6"
            >
              <div className="flex items-center justify-between gap-3">
                {/* 3 — Category chip stamps down onto the surface */}
                <m.span
                  variants={v(stampIn, 0.42)}
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-accent)]"
                >
                  Overtake
                </m.span>
                <m.span variants={v(fadeUp, 0.5)} className="text-xs font-medium uppercase tracking-wide text-[var(--color-faint-fg)]">
                  Medium
                </m.span>
              </div>

              <m.h3
                variants={v(fadeUp, 0.34)}
                className="mt-4 font-display text-[1.7rem] font-semibold leading-[1.08] tracking-tight sm:text-3xl"
              >
                Will Verstappen pass Norris for P2 within the next 2 laps?
              </m.h3>

              {/* 4 — Answers arrive last: the call to action lands after the question reads */}
              <div className="mt-6 grid grid-cols-2 gap-3">
                <m.button
                  type="button"
                  variants={v(fadeUp, 0.55)}
                  whileTap={reduced ? undefined : { scale: 0.97 }}
                  className="flex h-[64px] items-center justify-center rounded-[var(--radius)] bg-[var(--color-go)] font-display text-xl font-bold uppercase tracking-wide text-[#04130b]"
                >
                  Yes
                </m.button>
                <m.button
                  type="button"
                  variants={v(fadeUp, 0.62)}
                  whileTap={reduced ? undefined : { scale: 0.97 }}
                  className="flex h-[64px] items-center justify-center rounded-[var(--radius)] border border-[var(--color-border-strong)] bg-[var(--color-elevated)] font-display text-xl font-bold uppercase tracking-wide"
                >
                  No
                </m.button>
              </div>
            </m.div>
          </m.div>
        </AnimatePresence>
      </div>
      <div className="mt-4">
        <ReplayButton onClick={() => setRun((n) => n + 1)} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* HERO 2 — "Red Zone" (countdown panic)                                */
/* ------------------------------------------------------------------ */

const DEMO_COUNTDOWN_TOTAL = 15;

function Hero2RedZone({ reduced }: { reduced: boolean }) {
  const [secondsLeft, setSecondsLeft] = useState(DEMO_COUNTDOWN_TOTAL);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 0) {
          setRunning(false);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [running]);

  const progress = secondsLeft / DEMO_COUNTDOWN_TOTAL;
  const urgent = secondsLeft <= 10 && secondsLeft > 0;
  const critical = secondsLeft <= 3 && secondsLeft > 0;
  const color =
    secondsLeft === 0
      ? 'var(--color-accent)'
      : progress > 0.5
        ? 'var(--color-go)'
        : progress > 0.22
          ? 'var(--color-warn)'
          : 'var(--color-accent)';

  const dims = 132;
  const stroke = 9;
  const radius = (dims - stroke) / 2 - 1;
  const circumference = 2 * Math.PI * radius;

  return (
    <div>
      <div
        className={cn(
          'mt-5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-2)] p-6 transition-colors sm:p-8',
          critical && !reduced && 'animate-edge-glow'
        )}
      >
        <div className="flex flex-col items-center gap-5">
          <div
            className={cn(
              'relative inline-flex items-center justify-center rounded-full',
              urgent && !reduced && 'animate-pulse-ring'
            )}
            style={{ width: dims, height: dims }}
            role="timer"
            aria-label={`${secondsLeft} seconds remaining`}
          >
            <svg width={dims} height={dims} className="-rotate-90">
              <circle cx={dims / 2} cy={dims / 2} r={radius} fill="none" stroke="var(--color-border)" strokeWidth={stroke} />
              <circle
                cx={dims / 2}
                cy={dims / 2}
                r={radius}
                fill="none"
                stroke={color}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - progress)}
                className="transition-[stroke-dashoffset,stroke] duration-1000 ease-linear"
                style={{ filter: `drop-shadow(0 0 6px ${color})` }}
              />
            </svg>
            <div
              className={cn(
                'absolute inset-0 flex flex-col items-center justify-center font-display leading-none',
                urgent && !reduced && 'animate-heartbeat'
              )}
            >
              {/* Second tick: each digit change lands with a small pop in the red zone */}
              <AnimatePresence mode="popLayout" initial={false}>
                <m.span
                  key={secondsLeft}
                  initial={reduced || !urgent ? false : { scale: 1.25, opacity: 0.6 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.08 } }}
                  transition={springPop}
                  className="text-6xl font-bold"
                  style={{ color }}
                >
                  {secondsLeft}
                </m.span>
              </AnimatePresence>
              <span className="mt-1 text-[0.6rem] font-medium uppercase tracking-[0.24em] text-[var(--color-faint-fg)]">
                sec
              </span>
            </div>
          </div>

          <p className="text-center text-sm text-[var(--color-muted-fg)]">
            {secondsLeft === 0 ? (
              <span className="font-semibold uppercase tracking-wide text-[var(--color-accent)]">Answers locked</span>
            ) : critical ? (
              'Final call — edge of the card glows red.'
            ) : urgent ? (
              'Red zone — heartbeat + pulse ring + second ticks.'
            ) : progress > 0.5 ? (
              'Calm phase — steady green, no motion noise.'
            ) : (
              'Warning phase — amber, still quiet.'
            )}
          </p>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <ReplayButton
          label="Restart 15s"
          onClick={() => {
            setSecondsLeft(DEMO_COUNTDOWN_TOTAL);
            setRunning(true);
          }}
        />
        <span className="text-xs text-[var(--color-faint-fg)]">
          Production window is 45s — demo compressed to 15s.
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* HERO 3 — "Parc Fermé" (podium reveal)                                */
/* ------------------------------------------------------------------ */

const PODIUM_MOCK = [
  { place: 2 as const, name: 'Carlos', points: 870, height: 'h-20' },
  { place: 1 as const, name: 'Yuki', points: 1040, height: 'h-28' },
  { place: 3 as const, name: 'Alex', points: 795, height: 'h-16' },
];
const FIELD_MOCK = [
  { name: 'Oscar', points: 640 },
  { name: 'Nico', points: 555 },
  { name: 'Zhou', points: 410 },
];
const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
/* Reveal order is 3rd → 2nd → 1st; the winner lands last. */
const PODIUM_DELAY: Record<number, number> = { 3: 0.15, 2: 0.4, 1: 0.7 };

function Hero3Podium({ reduced }: { reduced: boolean }) {
  const [run, setRun] = useState(0);

  return (
    <div>
      <div className="relative mt-5 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-accent)]/40 bg-[linear-gradient(180deg,var(--color-elevated),var(--color-panel))] p-6 shadow-[var(--shadow)] sm:p-8">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(60%_100%_at_50%_0%,var(--color-accent-soft),transparent)]" />

        <AnimatePresence mode="wait">
          <m.div key={run} initial="hidden" animate="visible">
            {/* Confetti reuses the existing mq-rise keyframe */}
            {!reduced && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
                {Array.from({ length: 10 }).map((_, i) => (
                  <span
                    key={i}
                    className="absolute top-1/3 h-2 w-2 rounded-[1px]"
                    style={{
                      left: `${8 + i * 9}%`,
                      backgroundColor: i % 2 ? 'var(--color-accent)' : 'var(--color-warn)',
                      animation: `mq-rise ${1.6 + (i % 4) * 0.3}s ${0.9 + i * 0.1}s ease-out infinite`,
                    }}
                  />
                ))}
              </div>
            )}

            <m.div variants={reduced ? reducedFade : stampIn} className="relative text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--color-accent)]">🏁 Chequered flag</p>
              <h3 className="mt-2 font-display text-4xl font-bold uppercase tracking-tight">Yuki wins</h3>
            </m.div>

            <div className="relative mt-8 flex items-end justify-center gap-2 sm:gap-4">
              {PODIUM_MOCK.map(({ place, name, points, height }) => (
                <m.div
                  key={place}
                  variants={reduced ? reducedFade : withDelay(riseIn, PODIUM_DELAY[place])}
                  className="flex w-1/3 max-w-[160px] flex-col items-center"
                >
                  <span className="text-2xl">{MEDALS[place]}</span>
                  <p className="mt-1 max-w-full truncate font-display text-base font-semibold uppercase leading-tight">{name}</p>
                  <p className="font-display text-2xl font-bold leading-none">{points}</p>
                  <div
                    className={cn(
                      'relative mt-2 w-full overflow-hidden rounded-t-[var(--radius-sm)] border-t-2',
                      height,
                      place === 1
                        ? 'border-[var(--color-accent)] bg-[linear-gradient(180deg,var(--color-accent-soft),transparent)]'
                        : 'border-[var(--color-border-strong)] bg-[var(--color-muted)]'
                    )}
                  >
                    {/* Winner block gets one gold sheen sweep after landing */}
                    {place === 1 && !reduced && <span className="fx-sheen" style={{ animationDelay: '1.1s' }} aria-hidden />}
                  </div>
                </m.div>
              ))}
            </div>

            {/* Rest of the field files in quietly after the ceremony */}
            <m.div
              variants={reduced ? reducedFade : staggerContainer(0.08, 1.05)}
              className="relative mt-6 space-y-1.5 border-t border-[var(--color-border)] pt-4"
            >
              {FIELD_MOCK.map((entry, index) => (
                <m.div
                  key={entry.name}
                  variants={reduced ? reducedFade : fadeUp}
                  className="flex items-center gap-3 rounded-[var(--radius-sm)] bg-[var(--color-muted)] px-3 py-2"
                >
                  <span className="w-6 text-center font-display text-sm font-bold text-[var(--color-faint-fg)]">{index + 4}</span>
                  <p className="flex-1 truncate font-display text-base font-semibold uppercase">{entry.name}</p>
                  <span className="font-display text-lg font-bold">{entry.points}</span>
                </m.div>
              ))}
            </m.div>
          </m.div>
        </AnimatePresence>
      </div>
      <div className="mt-4">
        <ReplayButton onClick={() => setRun((n) => n + 1)} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Primitive gallery                                                    */
/* ------------------------------------------------------------------ */

function GalleryTile({
  title,
  note,
  children,
  onReplay,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
  onReplay?: () => void;
}) {
  return (
    <div className="flex flex-col rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-display text-base font-bold uppercase tracking-wide">{title}</p>
          <p className="mt-0.5 text-xs text-[var(--color-muted-fg)]">{note}</p>
        </div>
        {onReplay && (
          <button
            type="button"
            onClick={onReplay}
            aria-label={`Replay ${title}`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--color-border-strong)] text-sm text-[var(--color-accent)] transition-transform active:scale-90"
          >
            ▶
          </button>
        )}
      </div>
      <div className="mt-4 flex min-h-[96px] flex-1 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-bg-2)] p-4">
        {children}
      </div>
    </div>
  );
}

function VariantTile({
  title,
  note,
  variants,
  reduced,
  children,
}: {
  title: string;
  note: string;
  variants: Parameters<typeof withDelay>[0];
  reduced: boolean;
  children: React.ReactNode;
}) {
  const [run, setRun] = useState(0);
  return (
    <GalleryTile title={title} note={note} onReplay={() => setRun((n) => n + 1)}>
      <m.div key={run} variants={reduced ? reducedFade : variants} initial="hidden" animate="visible">
        {children}
      </m.div>
    </GalleryTile>
  );
}

function DemoChip({ tone = 'accent', children }: { tone?: 'accent' | 'go'; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[var(--radius-pill)] border px-3 py-1 text-xs font-semibold uppercase tracking-wide',
        tone === 'go'
          ? 'border-[var(--color-go)]/40 bg-[var(--color-go-soft)] text-[var(--color-go)]'
          : 'border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
      )}
    >
      {children}
    </span>
  );
}

function DemoSurface({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-elevated)] px-5 py-3 font-display text-sm font-semibold uppercase tracking-wide shadow-[var(--shadow-sm)]">
      {children}
    </div>
  );
}

/* Rank reorder — FLIP-equivalent using explicit y offsets (domAnimation-safe). */
const REORDER_ROW_H = 44;

function ReorderDemo({ reduced }: { reduced: boolean }) {
  const [order, setOrder] = useState(['Yuki', 'Carlos', 'Alex']);
  const [gainer, setGainer] = useState<string | null>(null);

  const shuffle = () => {
    setOrder((current) => {
      const next = [...current];
      const from = 1 + Math.floor(Math.random() * (next.length - 1));
      const [row] = next.splice(from, 1);
      next.unshift(row);
      setGainer(row);
      return next;
    });
  };

  return (
    <GalleryTile
      title="Rank reorder"
      note="Rows glide to their new position; the gainer flashes +N."
      onReplay={shuffle}
    >
      <div className="relative w-full max-w-[240px]" style={{ height: REORDER_ROW_H * 3 - 6 }}>
        {['Yuki', 'Carlos', 'Alex'].map((name) => {
          const index = order.indexOf(name);
          return (
            <m.div
              key={name}
              initial={false}
              animate={{ y: index * REORDER_ROW_H }}
              transition={reduced ? { duration: 0 } : springSettle}
              className={cn(
                'absolute inset-x-0 flex h-[38px] items-center gap-2 rounded-[var(--radius-sm)] px-3',
                gainer === name && index === 0
                  ? 'bg-[var(--color-accent-soft)] ring-1 ring-[var(--color-accent)]/50'
                  : 'bg-[var(--color-muted)]'
              )}
            >
              <span className="w-4 font-display text-sm font-bold text-[var(--color-faint-fg)]">{index + 1}</span>
              <span className="flex-1 truncate font-display text-sm font-semibold uppercase">{name}</span>
              {gainer === name && index === 0 && (
                <AnimatePresence>
                  <m.span
                    key={`${name}-${order.join()}`}
                    initial={reduced ? { opacity: 1 } : { opacity: 0, y: 6 }}
                    animate={{ opacity: [0, 1, 1, 0], y: reduced ? 0 : -14 }}
                    transition={{ duration: reduced ? 0.01 : 1.1, times: [0, 0.15, 0.7, 1] }}
                    className="font-display text-sm font-bold text-[var(--color-go)]"
                  >
                    +25
                  </m.span>
                </AnimatePresence>
              )}
            </m.div>
          );
        })}
      </div>
    </GalleryTile>
  );
}

function PrimitiveGallery({ reduced }: { reduced: boolean }) {
  const [glowRun, setGlowRun] = useState(0);
  const [sheenRun, setSheenRun] = useState(0);

  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <VariantTile title="fadeUp" note="Default entrance — content, list rows, secondary elements." variants={fadeUp} reduced={reduced}>
        <DemoSurface>Fade up</DemoSurface>
      </VariantTile>

      <VariantTile title="popIn" note="Spring confirm — resolution card, dialogs, answered state." variants={popIn} reduced={reduced}>
        <DemoSurface>Pop in</DemoSurface>
      </VariantTile>

      <VariantTile title="raceIn" note="Horizontal arrival with speed skew — the question card." variants={raceIn} reduced={reduced}>
        <DemoSurface>Race in →</DemoSurface>
      </VariantTile>

      <VariantTile title="stripIn" note="Hard snap from the left — race-control strips, banners." variants={stripIn} reduced={reduced}>
        <DemoChip>Race control</DemoChip>
      </VariantTile>

      <VariantTile title="stampIn" note="Scales down onto the surface — chips, verdicts, labels." variants={stampIn} reduced={reduced}>
        <DemoChip tone="go">✓ Nailed it</DemoChip>
      </VariantTile>

      <VariantTile title="riseIn" note="Slow vertical rise — reserved for podium & triumph." variants={riseIn} reduced={reduced}>
        <DemoSurface>Rise 🏆</DemoSurface>
      </VariantTile>

      <ReorderDemo reduced={reduced} />

      <GalleryTile
        title="Edge glow"
        note="CSS .animate-edge-glow — final 3 seconds of the countdown."
        onReplay={() => setGlowRun((n) => n + 1)}
      >
        <div
          key={glowRun}
          className={cn(
            'w-full max-w-[240px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-panel)] px-5 py-4 text-center font-display text-sm font-semibold uppercase',
            !reduced && 'animate-edge-glow'
          )}
        >
          3… 2… 1…
        </div>
      </GalleryTile>

      <GalleryTile
        title="Scan + sheen"
        note="CSS .fx-scan / .fx-sheen — one-shot broadcast sweeps."
        onReplay={() => setSheenRun((n) => n + 1)}
      >
        <div key={sheenRun} className="w-full max-w-[240px] space-y-3">
          <div className="relative overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-accent)]/45 bg-[var(--color-accent-soft)] px-4 py-2 font-display text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-accent)]">
            {!reduced && <span className="fx-scan" aria-hidden />}
            Bulletin scan
          </div>
          <div className="relative overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-warn)]/40 bg-[rgba(255,196,0,0.1)] px-4 py-2 font-display text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-warn)]">
            {!reduced && <span className="fx-sheen" style={{ animationDelay: '200ms' }} aria-hidden />}
            Winner sheen
          </div>
        </div>
      </GalleryTile>

      <GalleryTile title="Press feedback" note="whileTap scale 0.97 — every YES/NO and primary button.">
        <m.button
          type="button"
          whileTap={reduced ? undefined : { scale: 0.97 }}
          className="h-12 rounded-[var(--radius-pill)] bg-[var(--color-accent)] px-6 font-display text-sm font-bold uppercase tracking-wide text-white shadow-[var(--shadow-accent)]"
        >
          Hold me
        </m.button>
      </GalleryTile>

      <GalleryTile title="Heartbeat" note="CSS .animate-heartbeat — countdown digits in the red zone.">
        <span
          className={cn('font-display text-5xl font-bold text-[var(--color-accent)]', !reduced && 'animate-heartbeat')}
        >
          7
        </span>
      </GalleryTile>

      <GalleryTile title="Stagger" note="StaggerChildren — lobby lists, leaderboards, session pickers.">
        <StaggerDemo reduced={reduced} />
      </GalleryTile>
    </div>
  );
}

function StaggerDemo({ reduced }: { reduced: boolean }) {
  const [run, setRun] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setRun((n) => n + 1), 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <m.div
      key={run}
      variants={reduced ? reducedFade : staggerContainer(0.09)}
      initial="hidden"
      animate="visible"
      className="flex w-full max-w-[240px] flex-col gap-1.5"
    >
      {['P1 · Yuki', 'P2 · Carlos', 'P3 · Alex'].map((row) => (
        <m.div
          key={row}
          variants={reduced ? reducedFade : fadeUp}
          className="rounded-[var(--radius-sm)] bg-[var(--color-muted)] px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wide"
        >
          {row}
        </m.div>
      ))}
    </m.div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

export default function MotionLabPage() {
  const systemReduced = useReducedMotion();
  const [simulateReduced, setSimulateReduced] = useState(false);
  const reduced = systemReduced || simulateReduced;

  return (
    <MotionProvider>
      <main className="app-bg pad-safe-top pad-safe-bottom min-h-dvh px-5 pb-16">
        <div className="speed-lines pointer-events-none absolute inset-x-0 top-0 z-0 h-56 opacity-60" />

        <div className="relative z-10 mx-auto w-full max-w-3xl">
          <header className="py-8">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--color-accent)]">
              Dev sandbox · not linked in production
            </p>
            <h1 className="mt-2 font-display text-5xl font-bold uppercase tracking-tight">Motion Lab</h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-[var(--color-muted-fg)]">
              The &ldquo;Race Night&rdquo; motion language: fast in, controlled settle, ceremony only at the
              podium. Horizontal movement means a race event is arriving, radial pulses mean urgency,
              vertical rises mean triumph. Full spec in <code className="text-[var(--color-fg)]">frontend/MOTION.md</code>.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={reduced}
                onClick={() => setSimulateReduced((v) => !v)}
                disabled={systemReduced}
                className={cn(
                  'inline-flex h-11 items-center gap-2.5 rounded-[var(--radius-pill)] border px-4 font-display text-sm font-semibold uppercase tracking-wide transition-colors',
                  reduced
                    ? 'border-[var(--color-warn)]/50 bg-[rgba(255,196,0,0.12)] text-[var(--color-warn)]'
                    : 'border-[var(--color-border-strong)] bg-[var(--color-elevated)] text-[var(--color-muted-fg)]'
                )}
              >
                <span
                  className={cn(
                    'h-2.5 w-2.5 rounded-full',
                    reduced ? 'bg-[var(--color-warn)]' : 'bg-[var(--color-faint-fg)]'
                  )}
                />
                Reduced motion {reduced ? 'on' : 'off'}
              </button>
              <p className="text-xs text-[var(--color-faint-fg)]">
                {systemReduced
                  ? 'Your OS requests reduced motion — demos render final states instantly.'
                  : 'Toggle to preview the prefers-reduced-motion experience: instant states, no stagger, no loops.'}
              </p>
            </div>
          </header>

          <section className="mt-6">
            <SectionHeading
              kicker="Hero moment 01 · Tension"
              title="Race Control Bulletin"
              blurb="Question drop (TRIGGERED → LIVE). A race-control strip snaps in with a broadcast scanline, the card races in from the left with a hint of speed skew, the category chip stamps down, and the YES/NO buttons land last — the whole sequence reads left-to-right in under 800ms."
            />
            <Hero1QuestionDrop reduced={reduced} />
          </section>

          <section className="mt-14">
            <SectionHeading
              kicker="Hero moment 02 · Urgency"
              title="Red Zone"
              blurb="Countdown panic. The ring stays quiet while there's time — motion is earned, not constant. At 10 seconds the digits grow a heartbeat and every tick pops; at 3 seconds the card edge itself glows red. Urgency is radial: it pulses from the centre out."
            />
            <Hero2RedZone reduced={reduced} />
          </section>

          <section className="mt-14">
            <SectionHeading
              kicker="Hero moment 03 · Triumph"
              title="Parc Fermé"
              blurb="Podium reveal. The only sanctioned ceremony in the app: the headline stamps in, blocks rise 3rd → 2nd → 1st so the winner lands last, a single gold sheen sweeps the winning block, and the rest of the field files in quietly underneath. Triumph is vertical: it rises."
            />
            <Hero3Podium reduced={reduced} />
          </section>

          <section className="mt-14">
            <SectionHeading
              kicker="Building blocks"
              title="Primitive gallery"
              blurb="Reusable pieces from src/lib/motion/presets.ts, src/components/motion/, and the new mq- CSS keyframes. Every primitive collapses to an instant fade (or nothing) under prefers-reduced-motion."
            />
            <PrimitiveGallery reduced={reduced} />
          </section>

          <footer className="mt-14 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-panel)] p-5 text-sm leading-relaxed text-[var(--color-muted-fg)]">
            <p className="font-display text-base font-bold uppercase tracking-wide text-[var(--color-fg)]">
              Reduced motion contract
            </p>
            <p className="mt-2">
              Framer-motion entrances swap to an instant opacity fade (<code>reducedFade</code>), staggers
              collapse to zero, and looping CSS effects (heartbeat, edge glow, scan, sheen, confetti) are
              simply not rendered. The global CSS kill-switch in <code>globals.css</code> remains the
              backstop for everything else. State changes — locked answers, resolutions, rank order —
              are always communicated by color and copy first, motion second.
            </p>
          </footer>
        </div>
      </main>
    </MotionProvider>
  );
}
