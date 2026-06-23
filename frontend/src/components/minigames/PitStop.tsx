'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { useHighScore } from './useHighScore';
import { isExternalControlFocused } from './keys';

type Phase = 'idle' | 'running' | 'done';

const WHEELS = ['Front left', 'Front right', 'Rear left', 'Rear right'] as const;
const BASE_TIME = 1.8; // seconds of guaranteed stationary time
const PERFECT_HALF = 0.05; // |pos-0.5| within this = perfect (green)
const OK_HALF = 0.14; // within this = ok (yellow), else fumble (red)
const MAX_PENALTY = 1.4; // worst single-wheel time penalty (seconds)

function speedForWheel(index: number): number {
  // Fraction of bar travelled per second — ramps up each wheel.
  return 0.9 + index * 0.32;
}

export default function PitStop() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [wheelIndex, setWheelIndex] = useState(0);
  const [pos, setPos] = useState(0);
  const [results, setResults] = useState<Array<'perfect' | 'ok' | 'fumble'>>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [isRecord, setIsRecord] = useState(false);
  const { best, submit } = useHighScore('pitstop', { lowerIsBetter: true });

  const rafRef = useRef<number | null>(null);
  const dirRef = useRef(1);
  const posRef = useRef(0);
  const lastRef = useRef(0);
  const wheelRef = useRef(0);
  const penaltyRef = useRef(0);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  useEffect(() => stopLoop, [stopLoop]);

  const runLoop = useCallback(() => {
    const tick = (now: number) => {
      const dt = lastRef.current ? (now - lastRef.current) / 1000 : 0;
      lastRef.current = now;
      const speed = speedForWheel(wheelRef.current);
      let next = posRef.current + dirRef.current * speed * dt;
      if (next >= 1) {
        next = 1;
        dirRef.current = -1;
      } else if (next <= 0) {
        next = 0;
        dirRef.current = 1;
      }
      posRef.current = next;
      setPos(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    lastRef.current = 0;
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const start = useCallback(() => {
    stopLoop();
    setResults([]);
    setTotal(null);
    setIsRecord(false);
    setWheelIndex(0);
    wheelRef.current = 0;
    penaltyRef.current = 0;
    posRef.current = 0;
    dirRef.current = 1;
    setPos(0);
    setPhase('running');
    runLoop();
  }, [stopLoop, runLoop]);

  const lock = useCallback(() => {
    if (phase !== 'running') return;
    const error = Math.abs(posRef.current - 0.5);
    let grade: 'perfect' | 'ok' | 'fumble';
    let penalty: number;
    if (error <= PERFECT_HALF) {
      grade = 'perfect';
      penalty = 0;
    } else if (error <= OK_HALF) {
      grade = 'ok';
      penalty = (error / OK_HALF) * 0.4;
    } else {
      grade = 'fumble';
      penalty = 0.4 + ((error - OK_HALF) / (0.5 - OK_HALF)) * (MAX_PENALTY - 0.4);
    }
    penaltyRef.current += penalty;
    setResults((prev) => [...prev, grade]);

    const nextWheel = wheelRef.current + 1;
    if (nextWheel >= WHEELS.length) {
      stopLoop();
      const finalTime = Number((BASE_TIME + penaltyRef.current).toFixed(2));
      setTotal(finalTime);
      setIsRecord(submit(finalTime));
      setPhase('done');
      return;
    }
    wheelRef.current = nextWheel;
    setWheelIndex(nextWheel);
    posRef.current = 0;
    dirRef.current = 1;
    setPos(0);
  }, [phase, stopLoop, submit]);

  const handlePress = useCallback(() => {
    if (phase === 'idle' || phase === 'done') start();
    else lock();
  }, [phase, start, lock]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isExternalControlFocused()) return;
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        handlePress();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlePress]);

  const allPerfect = total !== null && results.every((r) => r === 'perfect');

  return (
    <div className="flex flex-col gap-4">
      <div className="relative min-h-[200px] rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] p-5">
        {/* Wheel progress pips */}
        <div className="mb-5 flex items-center justify-center gap-2">
          {WHEELS.map((label, i) => {
            const r = results[i];
            return (
              <span
                key={label}
                title={label}
                className={cn(
                  'h-2.5 w-2.5 rounded-full transition-colors',
                  r === 'perfect'
                    ? 'bg-[var(--color-go)]'
                    : r === 'ok'
                      ? 'bg-[var(--color-warn)]'
                      : r === 'fumble'
                        ? 'bg-[var(--color-danger)]'
                        : i === wheelIndex && phase === 'running'
                          ? 'bg-[var(--color-fg)] ring-2 ring-[var(--color-accent)]'
                          : 'bg-[var(--color-muted)]'
                )}
              />
            );
          })}
        </div>

        {phase === 'idle' && (
          <div className="flex min-h-[120px] flex-col items-center justify-center text-center">
            <p className="font-display text-2xl font-bold uppercase tracking-wide">Pit stop challenge</p>
            <p className="mt-2 max-w-[34ch] text-sm text-[var(--color-muted-fg)]">
              Stop the marker in the green zone for all four wheels. Nail every one for the perfect stop.
            </p>
          </div>
        )}

        {phase === 'running' && (
          <div className="flex flex-col items-center gap-4">
            <p className="font-display text-lg font-bold uppercase tracking-wide text-[var(--color-muted-fg)]">
              {WHEELS[wheelIndex]}
            </p>
            {/* Timing bar */}
            <div className="relative h-12 w-full overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-muted)]">
              {/* OK zone */}
              <div
                className="absolute inset-y-0 bg-[rgba(255,196,0,0.22)]"
                style={{ left: `${(0.5 - OK_HALF) * 100}%`, width: `${OK_HALF * 2 * 100}%` }}
              />
              {/* Perfect zone */}
              <div
                className="absolute inset-y-0 bg-[var(--color-go-soft)]"
                style={{ left: `${(0.5 - PERFECT_HALF) * 100}%`, width: `${PERFECT_HALF * 2 * 100}%` }}
              />
              {/* Center line */}
              <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--color-go)]/60" />
              {/* Marker */}
              <div
                className="absolute inset-y-1 w-1.5 -translate-x-1/2 rounded-full bg-[var(--color-fg)] shadow-[0_0_12px_rgba(255,255,255,0.6)]"
                style={{ left: `${pos * 100}%` }}
              />
            </div>
            <p className="text-xs text-[var(--color-faint-fg)]">Tap STOP in the green</p>
          </div>
        )}

        {phase === 'done' && total !== null && (
          <div className="flex min-h-[120px] flex-col items-center justify-center text-center animate-pop-in">
            <p className="font-display text-5xl font-black leading-none tracking-tight">
              {total.toFixed(2)}
              <span className="ml-1 text-xl font-bold text-[var(--color-muted-fg)]">s</span>
            </p>
            <p
              className={cn(
                'mt-1.5 text-sm font-semibold',
                allPerfect ? 'text-[var(--color-go)]' : 'text-[var(--color-muted-fg)]'
              )}
            >
              {isRecord ? '★ New personal best — ' : ''}
              {allPerfect ? 'Flawless pit stop!' : total < 2.4 ? 'Clean stop' : 'Bit messy in the box'}
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handlePress}
          className={cn(
            'h-12 flex-1 rounded-[var(--radius-pill)] font-display text-base font-bold uppercase tracking-wide transition-[transform,filter] duration-[var(--dur-fast)] active:translate-y-px',
            phase === 'running'
              ? 'bg-[var(--color-go)] text-[#04130b] hover:brightness-110'
              : 'bg-[var(--color-accent)] text-white shadow-[var(--shadow-accent)] hover:bg-[var(--color-accent-hot)]'
          )}
        >
          {phase === 'running' ? 'Stop' : phase === 'done' ? 'Go again' : 'Start stop'}
        </button>
        {best !== null && (
          <span className="shrink-0 text-xs text-[var(--color-faint-fg)]">
            Best: <span className="font-semibold text-[var(--color-fg)]">{best.toFixed(2)}s</span>
          </span>
        )}
      </div>
    </div>
  );
}
