'use client';

import { useCallback, useState } from 'react';

interface UseHighScoreOptions {
  /** When true, a lower score is considered better (e.g. reaction time, pit time). */
  lowerIsBetter?: boolean;
}

interface UseHighScore {
  best: number | null;
  /** Persists the score if it beats the current best. Returns true when a new record was set. */
  submit: (score: number) => boolean;
}

/**
 * Tiny localStorage-backed personal best tracker for the Pit Wall Arcade.
 * Scores are namespaced so each game keeps its own record across sessions.
 */
export function useHighScore(key: string, options: UseHighScoreOptions = {}): UseHighScore {
  const { lowerIsBetter = false } = options;
  const storageKey = `msq_arcade_${key}`;

  const [best, setBest] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  });

  const submit = useCallback(
    (score: number): boolean => {
      if (!Number.isFinite(score)) return false;

      let prev: number | null = null;
      if (typeof window !== 'undefined') {
        const raw = window.localStorage.getItem(storageKey);
        if (raw !== null) {
          const parsed = Number(raw);
          prev = Number.isFinite(parsed) ? parsed : null;
        }
      }

      const isRecord = prev === null || (lowerIsBetter ? score < prev : score > prev);
      if (isRecord) {
        try {
          window.localStorage.setItem(storageKey, String(score));
        } catch {
          // Storage may be unavailable (private mode); the in-memory best still updates.
        }
        setBest(score);
      }
      return isRecord;
    },
    [storageKey, lowerIsBetter]
  );

  return { best, submit };
}
