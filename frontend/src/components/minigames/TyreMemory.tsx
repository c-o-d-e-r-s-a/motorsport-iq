'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { useHighScore } from './useHighScore';

type Phase = 'idle' | 'showing' | 'input' | 'over';

const COMPOUNDS = [
  { label: 'Soft', color: '#ff2d2d', text: '#fff' },
  { label: 'Medium', color: '#ffd400', text: '#1a1500' },
  { label: 'Hard', color: '#eef0f4', text: '#0a0d12' },
  { label: 'Inter', color: '#1fd27a', text: '#04130b' },
] as const;

export default function TyreMemory() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const [inputIndex, setInputIndex] = useState(0);
  const [wrongPad, setWrongPad] = useState<number | null>(null);
  const [isRecord, setIsRecord] = useState(false);
  const { best, submit } = useHighScore('tyrememory', { lowerIsBetter: false });

  const sequenceRef = useRef<number[]>([]);
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);
  const phaseRef = useRef<Phase>('idle');

  const clearTimers = useCallback(() => {
    timeouts.current.forEach(clearTimeout);
    timeouts.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const playback = useCallback(
    (seq: number[]) => {
      clearTimers();
      phaseRef.current = 'showing';
      setPhase('showing');
      setActive(null);
      const stepOn = 520;
      const stepGap = 220;
      seq.forEach((pad, i) => {
        timeouts.current.push(
          setTimeout(() => setActive(pad), i * (stepOn + stepGap) + 350)
        );
        timeouts.current.push(
          setTimeout(() => setActive(null), i * (stepOn + stepGap) + 350 + stepOn)
        );
      });
      timeouts.current.push(
        setTimeout(() => {
          phaseRef.current = 'input';
          setPhase('input');
          setInputIndex(0);
        }, seq.length * (stepOn + stepGap) + 350)
      );
    },
    [clearTimers]
  );

  const nextRound = useCallback(() => {
    sequenceRef.current = [
      ...sequenceRef.current,
      Math.floor(Math.random() * COMPOUNDS.length),
    ];
    setRound(sequenceRef.current.length);
    playback(sequenceRef.current);
  }, [playback]);

  const start = useCallback(() => {
    clearTimers();
    sequenceRef.current = [];
    setIsRecord(false);
    setWrongPad(null);
    nextRound();
  }, [clearTimers, nextRound]);

  const handlePad = useCallback(
    (pad: number) => {
      if (phaseRef.current !== 'input') return;
      const expected = sequenceRef.current[inputIndex];
      if (pad !== expected) {
        clearTimers();
        phaseRef.current = 'over';
        setWrongPad(pad);
        setIsRecord(submit(sequenceRef.current.length - 1));
        setPhase('over');
        return;
      }
      // Brief flash feedback
      setActive(pad);
      timeouts.current.push(setTimeout(() => setActive(null), 160));

      const nextIndex = inputIndex + 1;
      if (nextIndex >= sequenceRef.current.length) {
        phaseRef.current = 'showing';
        timeouts.current.push(setTimeout(() => nextRound(), 650));
      } else {
        setInputIndex(nextIndex);
      }
    },
    [inputIndex, clearTimers, submit, nextRound]
  );

  const statusText =
    phase === 'showing'
      ? 'Watch the strategy…'
      : phase === 'input'
        ? 'Repeat the order'
        : phase === 'over'
          ? 'Wrong call!'
          : 'Memorise the tyre order, then repeat it.';

  return (
    <div className="flex flex-col gap-4">
      <div className="relative rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] p-5">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-faint-fg)]">
            {phase === 'idle' || phase === 'over' ? 'Strategy recall' : `Stint ${round}`}
          </span>
          <span
            className={cn(
              'text-xs font-semibold',
              phase === 'over' ? 'text-[var(--color-danger)]' : 'text-[var(--color-muted-fg)]'
            )}
          >
            {statusText}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {COMPOUNDS.map((c, i) => {
            const lit = active === i;
            const isWrong = wrongPad === i;
            const interactive = phase === 'input';
            return (
              <button
                key={c.label}
                type="button"
                disabled={!interactive}
                onClick={() => handlePad(i)}
                className={cn(
                  'flex h-[68px] items-center justify-center rounded-[var(--radius-sm)] border-2 font-display text-lg font-bold uppercase tracking-wide transition-all duration-100 sm:h-20',
                  interactive ? 'cursor-pointer' : 'cursor-default',
                  isWrong && 'animate-shake border-[var(--color-danger)]'
                )}
                style={{
                  background: lit ? c.color : 'var(--color-muted)',
                  color: lit ? c.text : 'var(--color-muted-fg)',
                  borderColor: lit ? c.color : 'var(--color-border)',
                  boxShadow: lit ? `0 0 22px ${c.color}` : 'none',
                  opacity: !lit && (phase === 'showing' || phase === 'over') ? 0.6 : 1,
                }}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        {phase === 'over' && (
          <div className="mt-4 text-center animate-fade-in">
            <p className="font-display text-3xl font-black leading-none">
              {Math.max(0, round - 1)}
            </p>
            <p className="text-sm text-[var(--color-muted-fg)]">
              {isRecord ? '★ New personal best — ' : ''}stints recalled
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={start}
          disabled={phase === 'showing' || phase === 'input'}
          className="h-12 flex-1 rounded-[var(--radius-pill)] bg-[var(--color-accent)] font-display text-base font-bold uppercase tracking-wide text-white shadow-[var(--shadow-accent)] transition-[filter] hover:bg-[var(--color-accent-hot)] active:translate-y-px disabled:opacity-45 disabled:shadow-none"
        >
          {phase === 'over' ? 'Try again' : phase === 'idle' ? 'Start' : 'In progress…'}
        </button>
        {best !== null && (
          <span className="shrink-0 text-xs text-[var(--color-faint-fg)]">
            Best: <span className="font-semibold text-[var(--color-fg)]">{best}</span>
          </span>
        )}
      </div>
    </div>
  );
}
