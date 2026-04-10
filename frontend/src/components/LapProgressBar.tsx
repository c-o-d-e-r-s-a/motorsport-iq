'use client';

import { useEffect, useState, useRef } from 'react';
import { cn } from '@/lib/cn';

interface LapProgressBarProps {
  lapNumber: number;
  totalLaps: number | null;
  leaderLapTime: number | null;
  leaderLapStartTime: string | null;
  raceCompleted: boolean;
  highlighted?: boolean;
}

function calculateProgress(lapStartTime: number, leaderLapTime: number | null, currentTime: number): number {
  if (!leaderLapTime || leaderLapTime <= 0) {
    return 0;
  }

  const elapsedMs = Math.max(0, currentTime - lapStartTime);
  const lapDurationMs = leaderLapTime * 1000;

  return Math.min(100, Math.max(0, (elapsedMs / lapDurationMs) * 100));
}

export default function LapProgressBar({
  lapNumber,
  totalLaps,
  leaderLapTime,
  leaderLapStartTime,
  raceCompleted,
  highlighted = false,
}: LapProgressBarProps) {
  // Track lap start time based on telemetry lap start time from backend
  const lapStartTimeRef = useRef<number>(0);
  const previousLapNumberRef = useRef<number>(lapNumber);
  const lastProgressRef = useRef<number>(0);

  useEffect(() => {
    if (lapStartTimeRef.current === 0) {
      lapStartTimeRef.current = leaderLapStartTime ? new Date(leaderLapStartTime).getTime() : Date.now();
    }

    // Reset on actual lap transition
    if (lapNumber !== previousLapNumberRef.current) {
      if (leaderLapStartTime) {
        lapStartTimeRef.current = new Date(leaderLapStartTime).getTime();
      } else {
        lapStartTimeRef.current = Date.now();
      }
      previousLapNumberRef.current = lapNumber;
      lastProgressRef.current = 0;
      return;
    }

    // Refresh lap start anchor if telemetry start time updates for current lap
    if (leaderLapStartTime) {
      lapStartTimeRef.current = new Date(leaderLapStartTime).getTime();
    }
  }, [leaderLapStartTime, lapNumber]);

  const [progress, setProgress] = useState(() => (raceCompleted ? 100 : 0));

  useEffect(() => {
    if (raceCompleted) {
      return;
    }

    const updateProgress = () => {
      const nextProgress = calculateProgress(lapStartTimeRef.current, leaderLapTime, Date.now());
      const monotonicProgress = Math.max(lastProgressRef.current, nextProgress);
      lastProgressRef.current = monotonicProgress;
      setProgress(monotonicProgress);
    };

    updateProgress();
    const interval = window.setInterval(() => {
      updateProgress();
    }, 250);

    return () => window.clearInterval(interval);
  }, [leaderLapTime, raceCompleted]);

  const displayProgress = raceCompleted ? 100 : progress;

  return (
    <div
      className={cn(
        'mt-4 border-2 border-[var(--color-border)] bg-[var(--color-bg)] p-3 transition-[box-shadow,border-color] duration-300',
        highlighted && 'border-[var(--color-accent)] shadow-[0_0_0_2px_rgba(255,24,1,0.12)]'
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-display text-xs uppercase tracking-[0.18em] text-[var(--color-muted-fg)]">Lap Progress</p>
        <p className="font-display text-xs uppercase tracking-[0.18em] text-[var(--color-fg)]">
          Lap {lapNumber}{totalLaps ? ` / ${totalLaps}` : ''}
        </p>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-border),transparent_30%)]">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,#ff1801_0%,#ff7b00_100%)] transition-[width] duration-200"
          style={{ width: `${displayProgress}%` }}
        />
      </div>
      <p className="mt-2 font-display text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-fg)]">
        {Math.round(displayProgress)}% through the current lap
      </p>
    </div>
  );
}
