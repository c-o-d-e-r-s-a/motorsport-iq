'use client';

import { useEffect, useState } from 'react';

export function formatRaceStartCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function useRaceStartCountdown(dateStart: string): string {
  const targetMs = new Date(dateStart).getTime();
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, targetMs - Date.now()));

  useEffect(() => {
    const tick = () => setRemainingMs(Math.max(0, targetMs - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetMs]);

  return formatRaceStartCountdown(remainingMs);
}
