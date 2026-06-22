'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { useHighScore } from './useHighScore';

type Phase = 'idle' | 'arming' | 'set' | 'go' | 'result' | 'jump';

const LIGHT_COUNT = 5;
const LIGHT_STEP_MS = 600;

function ratingFor(ms: number): { label: string; tone: string } {
  if (ms < 180) return { label: 'Lightning reflexes', tone: 'text-[var(--color-accent)]' };
  if (ms < 230) return { label: 'Pro grid pace', tone: 'text-[var(--color-go)]' };
  if (ms < 320) return { label: 'Quick off the line', tone: 'text-[var(--color-go)]' };
  if (ms < 450) return { label: 'Solid getaway', tone: 'text-[var(--color-warn)]' };
  return { label: 'Bogged down', tone: 'text-[var(--color-muted-fg)]' };
}

export default function ReactionLights() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [litCount, setLitCount] = useState(0);
  const [reaction, setReaction] = useState<number | null>(null);
  const [isRecord, setIsRecord] = useState(false);
  const { best, submit } = useHighScore('reaction', { lowerIsBetter: true });

  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);
  const goAtRef = useRef<number>(0);

  const clearTimers = useCallback(() => {
    timeouts.current.forEach(clearTimeout);
    timeouts.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const start = useCallback(() => {
    clearTimers();
    setReaction(null);
    setIsRecord(false);
    setLitCount(0);
    setPhase('arming');

    for (let i = 1; i <= LIGHT_COUNT; i++) {
      timeouts.current.push(
        setTimeout(() => {
          setLitCount(i);
          if (i === LIGHT_COUNT) setPhase('set');
        }, i * LIGHT_STEP_MS)
      );
    }

    // Random hold after all five are lit, then lights out = GO.
    const hold = 700 + Math.random() * 2600;
    timeouts.current.push(
      setTimeout(() => {
        setLitCount(0);
        setPhase('go');
        goAtRef.current = performance.now();
      }, LIGHT_COUNT * LIGHT_STEP_MS + hold)
    );
  }, [clearTimers]);

  const handlePress = useCallback(() => {
    if (phase === 'idle' || phase === 'result' || phase === 'jump') {
      start();
      return;
    }
    if (phase === 'arming' || phase === 'set') {
      // Tapped before lights out — jump start.
      clearTimers();
      setPhase('jump');
      setLitCount(0);
      return;
    }
    if (phase === 'go') {
      const ms = Math.round(performance.now() - goAtRef.current);
      setReaction(ms);
      setIsRecord(submit(ms));
      setPhase('result');
    }
  }, [phase, start, clearTimers, submit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        handlePress();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlePress]);

  const isLightsOut = phase === 'go';
  const rating = reaction !== null ? ratingFor(reaction) : null;

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={handlePress}
        aria-label="Reaction test area — tap when the lights go out"
        className={cn(
          'relative flex min-h-[200px] w-full flex-col items-center justify-center gap-5 overflow-hidden rounded-[var(--radius)] border p-6 transition-colors duration-150 select-none',
          isLightsOut
            ? 'border-[var(--color-go)]/60 bg-[var(--color-go-soft)]'
            : phase === 'jump'
              ? 'border-[var(--color-danger)]/60 bg-[rgba(255,59,59,0.12)]'
              : 'border-[var(--color-border)] bg-[var(--color-bg)]'
        )}
      >
        {/* Light gantry */}
        <div className="flex items-end gap-2.5 sm:gap-3">
          {Array.from({ length: LIGHT_COUNT }).map((_, i) => {
            const on = i < litCount;
            return (
              <span
                key={i}
                className={cn(
                  'h-9 w-9 rounded-full border transition-all duration-100 sm:h-11 sm:w-11',
                  on
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)] shadow-[0_0_18px_rgba(255,33,20,0.7)]'
                    : 'border-[var(--color-border-strong)] bg-[var(--color-muted)]'
                )}
              />
            );
          })}
        </div>

        {/* Centered status */}
        <div className="text-center">
          {phase === 'idle' && (
            <p className="font-display text-xl font-bold uppercase tracking-wide">Tap to start</p>
          )}
          {(phase === 'arming' || phase === 'set') && (
            <p className="font-display text-xl font-bold uppercase tracking-wide text-[var(--color-muted-fg)]">
              Wait for it…
            </p>
          )}
          {isLightsOut && (
            <p className="animate-pop-in font-display text-3xl font-black uppercase tracking-wide text-[var(--color-go)]">
              GO!
            </p>
          )}
          {phase === 'jump' && (
            <>
              <p className="font-display text-2xl font-black uppercase tracking-wide text-[var(--color-danger)]">
                Jump start!
              </p>
              <p className="mt-1 text-sm text-[var(--color-muted-fg)]">Tap to try again</p>
            </>
          )}
          {phase === 'result' && reaction !== null && rating && (
            <>
              <p className="font-display text-5xl font-black leading-none tracking-tight">
                {reaction}
                <span className="ml-1 text-xl font-bold text-[var(--color-muted-fg)]">ms</span>
              </p>
              <p className={cn('mt-1.5 text-sm font-semibold', rating.tone)}>
                {isRecord ? '★ New personal best — ' : ''}
                {rating.label}
              </p>
              <p className="mt-1 text-xs text-[var(--color-faint-fg)]">Tap to race again</p>
            </>
          )}
        </div>
      </button>

      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--color-faint-fg)]">
          {best !== null ? (
            <>
              Best: <span className="font-semibold text-[var(--color-fg)]">{best} ms</span>
            </>
          ) : (
            'Five lights, then go.'
          )}
        </span>
        <span className="hidden text-[var(--color-faint-fg)] sm:inline">Tap or hit Space</span>
      </div>
    </div>
  );
}
