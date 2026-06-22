'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { useHighScore } from './useHighScore';

type Phase = 'idle' | 'running' | 'over';

interface Rival {
  id: number;
  lane: number;
  y: number; // 0 (top) .. 1 (bottom), fraction of play height
  hue: number;
  scored: boolean;
}

const LANES = 3;
const PLAYER_Y = 0.86;
const HIT_BAND = 0.07;
const BASE_SPEED = 0.42; // fraction of height per second
const SPEED_RAMP = 0.018; // added per point
const BASE_SPAWN = 1.05; // seconds between rivals
const MIN_SPAWN = 0.45;

const RIVAL_HUES = [210, 280, 48, 150, 0];

export default function GridDash() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [score, setScore] = useState(0);
  const [playerLane, setPlayerLane] = useState(1);
  const [rivals, setRivals] = useState<Rival[]>([]);
  const [isRecord, setIsRecord] = useState(false);
  const { best, submit } = useHighScore('griddash', { lowerIsBetter: false });

  const rafRef = useRef<number | null>(null);
  const laneRef = useRef(1);
  const rivalsRef = useRef<Rival[]>([]);
  const scoreRef = useRef(0);
  const spawnTimerRef = useRef(0);
  const lastRef = useRef(0);
  const idRef = useRef(0);
  const phaseRef = useRef<Phase>('idle');

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  useEffect(() => stopLoop, [stopLoop]);

  const endGame = useCallback(() => {
    stopLoop();
    phaseRef.current = 'over';
    setIsRecord(submit(scoreRef.current));
    setPhase('over');
  }, [stopLoop, submit]);

  const spawn = useCallback(() => {
    idRef.current += 1;
    const lane = Math.floor(Math.random() * LANES);
    rivalsRef.current.push({
      id: idRef.current,
      lane,
      y: -0.12,
      hue: RIVAL_HUES[Math.floor(Math.random() * RIVAL_HUES.length)],
      scored: false,
    });
  }, []);

  const loop = useCallback(
    (now: number) => {
      const dt = lastRef.current ? Math.min((now - lastRef.current) / 1000, 0.05) : 0;
      lastRef.current = now;

      const speed = BASE_SPEED + scoreRef.current * SPEED_RAMP;
      const spawnEvery = Math.max(MIN_SPAWN, BASE_SPAWN - scoreRef.current * 0.02);

      spawnTimerRef.current += dt;
      if (spawnTimerRef.current >= spawnEvery) {
        spawnTimerRef.current = 0;
        spawn();
      }

      const next: Rival[] = [];
      for (const r of rivalsRef.current) {
        const y = r.y + speed * dt;
        // Collision with player
        if (r.lane === laneRef.current && Math.abs(y - PLAYER_Y) < HIT_BAND) {
          rivalsRef.current = next.concat({ ...r, y });
          setRivals([...rivalsRef.current]);
          endGame();
          return;
        }
        let scored = r.scored;
        if (!scored && y > PLAYER_Y + HIT_BAND) {
          scored = true;
          scoreRef.current += 1;
          setScore(scoreRef.current);
        }
        if (y < 1.2) next.push({ ...r, y, scored });
      }
      rivalsRef.current = next;
      setRivals([...next]);

      rafRef.current = requestAnimationFrame(loop);
    },
    [spawn, endGame]
  );

  const start = useCallback(() => {
    stopLoop();
    rivalsRef.current = [];
    scoreRef.current = 0;
    spawnTimerRef.current = 0.6;
    laneRef.current = 1;
    lastRef.current = 0;
    idRef.current = 0;
    phaseRef.current = 'running';
    setRivals([]);
    setScore(0);
    setPlayerLane(1);
    setIsRecord(false);
    setPhase('running');
    rafRef.current = requestAnimationFrame(loop);
  }, [stopLoop, loop]);

  const move = useCallback((dir: -1 | 1) => {
    if (phaseRef.current !== 'running') return;
    const next = Math.max(0, Math.min(LANES - 1, laneRef.current + dir));
    laneRef.current = next;
    setPlayerLane(next);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        move(-1);
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        move(1);
      } else if ((e.code === 'Space' || e.code === 'Enter') && phaseRef.current !== 'running') {
        e.preventDefault();
        start();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move, start]);

  const handleAreaPointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (phaseRef.current !== 'running') return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      move(x < rect.width / 2 ? -1 : 1);
    },
    [move]
  );

  const laneCenter = (lane: number) => ((lane + 0.5) / LANES) * 100;

  return (
    <div className="flex flex-col gap-4">
      <div
        onPointerDown={handleAreaPointer}
        className="relative h-[290px] w-full select-none overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] sm:h-[330px]"
      >
        {/* Lane dividers + moving road lines */}
        <div className="pointer-events-none absolute inset-0 speed-lines opacity-40" />
        {Array.from({ length: LANES - 1 }).map((_, i) => (
          <div
            key={i}
            className="pointer-events-none absolute inset-y-0 w-px bg-[var(--color-border)]"
            style={{ left: `${((i + 1) / LANES) * 100}%` }}
          />
        ))}

        {/* Rivals */}
        {rivals.map((r) => (
          <Car
            key={r.id}
            left={laneCenter(r.lane)}
            top={r.y * 100}
            color={`hsl(${r.hue} 70% 55%)`}
          />
        ))}

        {/* Player */}
        {phase !== 'idle' && (
          <Car
            left={laneCenter(playerLane)}
            top={PLAYER_Y * 100}
            color="var(--color-accent)"
            isPlayer
          />
        )}

        {/* Live score */}
        {phase === 'running' && (
          <div className="pointer-events-none absolute right-3 top-2.5 font-display text-2xl font-black tabular-nums">
            {score}
          </div>
        )}

        {/* Idle overlay */}
        {phase === 'idle' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="font-display text-2xl font-bold uppercase tracking-wide">Grid dash</p>
            <p className="max-w-[34ch] text-sm text-[var(--color-muted-fg)]">
              Weave through traffic and overtake every car. One contact ends your run.
            </p>
          </div>
        )}

        {/* Game over overlay */}
        {phase === 'over' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-[var(--color-bg)]/85 text-center backdrop-blur-sm animate-fade-in">
            <p className="font-display text-sm font-bold uppercase tracking-[0.2em] text-[var(--color-danger)]">
              Contact
            </p>
            <p className="font-display text-5xl font-black leading-none">{score}</p>
            <p className="text-sm text-[var(--color-muted-fg)]">cars overtaken</p>
            {isRecord && (
              <p className="mt-1 text-sm font-semibold text-[var(--color-go)]">★ New personal best</p>
            )}
          </div>
        )}
      </div>

      {phase === 'running' ? (
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              move(-1);
            }}
            className="h-12 rounded-[var(--radius-pill)] border border-[var(--color-border-strong)] bg-[var(--color-elevated)] font-display text-xl font-bold active:translate-y-px"
            aria-label="Move left"
          >
            ◀
          </button>
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              move(1);
            }}
            className="h-12 rounded-[var(--radius-pill)] border border-[var(--color-border-strong)] bg-[var(--color-elevated)] font-display text-xl font-bold active:translate-y-px"
            aria-label="Move right"
          >
            ▶
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={start}
            className="h-12 flex-1 rounded-[var(--radius-pill)] bg-[var(--color-accent)] font-display text-base font-bold uppercase tracking-wide text-white shadow-[var(--shadow-accent)] transition-[filter] hover:bg-[var(--color-accent-hot)] active:translate-y-px"
          >
            {phase === 'over' ? 'Race again' : 'Lights out'}
          </button>
          {best !== null && (
            <span className="shrink-0 text-xs text-[var(--color-faint-fg)]">
              Best: <span className="font-semibold text-[var(--color-fg)]">{best}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Car({
  left,
  top,
  color,
  isPlayer = false,
}: {
  left: number;
  top: number;
  color: string;
  isPlayer?: boolean;
}) {
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${left}%`, top: `${top}%` }}
    >
      <div
        className={cn(
          'relative h-12 w-7 rounded-[10px] sm:h-14 sm:w-8',
          isPlayer && 'shadow-[0_0_16px_rgba(255,33,20,0.55)]'
        )}
        style={{ background: color }}
      >
        {/* Cockpit */}
        <div className="absolute left-1/2 top-1/2 h-3.5 w-3 -translate-x-1/2 -translate-y-1/2 rounded-[4px] bg-black/35" />
        {/* Wings */}
        <div className="absolute -left-1 top-1 h-1.5 w-2 rounded-sm" style={{ background: color }} />
        <div className="absolute -right-1 top-1 h-1.5 w-2 rounded-sm" style={{ background: color }} />
        <div className="absolute -left-1 bottom-1 h-1.5 w-2 rounded-sm" style={{ background: color }} />
        <div className="absolute -right-1 bottom-1 h-1.5 w-2 rounded-sm" style={{ background: color }} />
      </div>
    </div>
  );
}
