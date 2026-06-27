'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { useArcadePause } from './ArcadePauseContext';
import ArcadePauseButton from './ArcadePauseButton';
import { useHighScore } from './useHighScore';

type Phase = 'idle' | 'showing' | 'input' | 'over';

const COMPOUNDS = [
  { label: 'Soft', color: '#ff2d2d', text: '#fff' },
  { label: 'Medium', color: '#ffd400', text: '#1a1500' },
  { label: 'Hard', color: '#eef0f4', text: '#0a0d12' },
  { label: 'Inter', color: '#1fd27a', text: '#04130b' },
] as const;

const STEP_ON = 520;
const STEP_GAP = 220;
const STEP_TOTAL = STEP_ON + STEP_GAP;

export default function TyreMemory() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const [inputIndex, setInputIndex] = useState(0);
  const [wrongPad, setWrongPad] = useState<number | null>(null);
  const [isRecord, setIsRecord] = useState(false);
  const { best, submit } = useHighScore('tyrememory', { lowerIsBetter: false });
  const { isPaused } = useArcadePause();

  const sequenceRef = useRef<number[]>([]);
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);
  const phaseRef = useRef<Phase>('idle');
  const inputIndexRef = useRef(0);
  const showingFromRef = useRef(0);
  const pausedRef = useRef(false);
  const pauseSnapshotRef = useRef<{ phase: Phase; inputIndex: number; showingFrom: number } | null>(
    null
  );

  const clearTimers = useCallback(() => {
    timeouts.current.forEach(clearTimeout);
    timeouts.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  useEffect(() => {
    pausedRef.current = isPaused;
  }, [isPaused]);

  const schedulePlayback = useCallback(
    (seq: number[], fromIndex: number) => {
      clearTimers();
      phaseRef.current = 'showing';
      setPhase('showing');
      setActive(null);
      showingFromRef.current = fromIndex;

      const remaining = seq.slice(fromIndex);
      remaining.forEach((pad, i) => {
        const absoluteIndex = fromIndex + i;
        timeouts.current.push(
          setTimeout(() => {
            if (pausedRef.current) return;
            setActive(pad);
          }, i * STEP_TOTAL + 350)
        );
        timeouts.current.push(
          setTimeout(() => {
            if (pausedRef.current) return;
            setActive(null);
            showingFromRef.current = absoluteIndex + 1;
          }, i * STEP_TOTAL + 350 + STEP_ON)
        );
      });

      timeouts.current.push(
        setTimeout(() => {
          if (pausedRef.current) return;
          phaseRef.current = 'input';
          setPhase('input');
          setInputIndex(0);
          inputIndexRef.current = 0;
        }, remaining.length * STEP_TOTAL + 350)
      );
    },
    [clearTimers]
  );

  const playback = useCallback(
    (seq: number[]) => {
      schedulePlayback(seq, 0);
    },
    [schedulePlayback]
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
    pauseSnapshotRef.current = null;
    setIsRecord(false);
    setWrongPad(null);
    nextRound();
  }, [clearTimers, nextRound]);

  const handlePad = useCallback(
    (pad: number) => {
      if (phaseRef.current !== 'input' || pausedRef.current) return;
      const expected = sequenceRef.current[inputIndexRef.current];
      if (pad !== expected) {
        clearTimers();
        phaseRef.current = 'over';
        setWrongPad(pad);
        setIsRecord(submit(sequenceRef.current.length - 1));
        setPhase('over');
        return;
      }

      setActive(pad);
      timeouts.current.push(setTimeout(() => setActive(null), 160));

      const nextIndex = inputIndexRef.current + 1;
      if (nextIndex >= sequenceRef.current.length) {
        phaseRef.current = 'showing';
        inputIndexRef.current = nextIndex;
        setInputIndex(nextIndex);
        timeouts.current.push(
          setTimeout(() => {
            if (!pausedRef.current) nextRound();
          }, 650)
        );
      } else {
        inputIndexRef.current = nextIndex;
        setInputIndex(nextIndex);
      }
    },
    [clearTimers, submit, nextRound]
  );

  useEffect(() => {
    if (isPaused) {
      if (phaseRef.current === 'showing' || phaseRef.current === 'input') {
        pauseSnapshotRef.current = {
          phase: phaseRef.current,
          inputIndex: inputIndexRef.current,
          showingFrom: showingFromRef.current,
        };
      }
      clearTimers();
      return;
    }

    const snapshot = pauseSnapshotRef.current;
    if (!snapshot) return;

    pauseSnapshotRef.current = null;
    if (snapshot.phase === 'input') {
      phaseRef.current = 'input';
      inputIndexRef.current = snapshot.inputIndex;
      setPhase('input');
      setInputIndex(snapshot.inputIndex);
      return;
    }

    if (snapshot.phase === 'showing') {
      schedulePlayback(sequenceRef.current, snapshot.showingFrom);
    }
  }, [isPaused, clearTimers, schedulePlayback]);

  const statusText =
    isPaused && (phase === 'showing' || phase === 'input')
      ? 'Paused'
      : phase === 'showing'
        ? 'Watch the strategy…'
        : phase === 'input'
          ? 'Repeat the order'
          : phase === 'over'
            ? 'Wrong call!'
            : 'Memorise the tyre order, then repeat it.';

  const inActiveRound = phase === 'showing' || phase === 'input';

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

        <div className={cn('grid grid-cols-2 gap-3', isPaused && inActiveRound && 'opacity-60')}>
          {COMPOUNDS.map((c, i) => {
            const lit = active === i;
            const isWrong = wrongPad === i;
            const interactive = phase === 'input' && !isPaused;
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

      {inActiveRound ? (
        <ArcadePauseButton className="w-full" />
      ) : (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={start}
            className="h-12 flex-1 rounded-[var(--radius-pill)] bg-[var(--color-accent)] font-display text-base font-bold uppercase tracking-wide text-white shadow-[var(--shadow-accent)] transition-[filter] hover:bg-[var(--color-accent-hot)] active:translate-y-px"
          >
            {phase === 'over' ? 'Try again' : 'Start'}
          </button>
          {best !== null && (
            <span className="shrink-0 text-xs text-[var(--color-faint-fg)]">
              Best: <span className="font-semibold text-[var(--color-fg)]">{best}</span>
            </span>
          )}
        </div>
      )}

      {inActiveRound && best !== null && (
        <p className="text-center text-xs text-[var(--color-faint-fg)]">
          Best: <span className="font-semibold text-[var(--color-fg)]">{best}</span>
        </p>
      )}
    </div>
  );
}
