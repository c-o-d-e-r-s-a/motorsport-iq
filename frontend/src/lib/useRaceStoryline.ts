'use client';

/**
 * Parc Fermé Debrief — client-side race storyline recorder.
 *
 * Accumulates a per-question history (what was asked, what you answered, how
 * it resolved, points swing) as resolution events arrive, so the post-race
 * debrief can replay your race. Persisted to sessionStorage per lobby so a
 * mid-race reconnect keeps the story. Display-only — reads server events,
 * never influences them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Difficulty, QuestionCategory, ResolutionEvent } from '@/lib/types';

export interface StoryEntry {
  instanceId: string;
  questionText: string;
  category: QuestionCategory | null;
  difficulty: Difficulty | null;
  myAnswer: 'YES' | 'NO' | null;
  correctAnswer: 'YES' | 'NO';
  /** null when the player never locked an answer in. */
  wasCorrect: boolean | null;
  pointsChange: number;
  /** Running total after this question, when the server reported it. */
  myPointsAfter: number | null;
  recordedAt: number;
}

interface RecordContext {
  category: QuestionCategory | null;
  difficulty: Difficulty | null;
  myAnswer: 'YES' | 'NO' | null;
  currentUserId: string | null;
}

const STORAGE_PREFIX = 'msp_story_';
const MAX_ENTRIES = 40;

function storageKey(lobbyCode: string): string {
  return `${STORAGE_PREFIX}${lobbyCode.toUpperCase()}`;
}

function loadStoryline(lobbyCode: string): StoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(storageKey(lobbyCode));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function useRaceStoryline(lobbyCode: string) {
  const [history, setHistory] = useState<StoryEntry[]>(() => loadStoryline(lobbyCode));
  const historyRef = useRef(history);

  useEffect(() => {
    historyRef.current = history;
    try {
      sessionStorage.setItem(storageKey(lobbyCode), JSON.stringify(history));
    } catch {
      /* storage full/unavailable — debrief just shows what it has in memory */
    }
  }, [history, lobbyCode]);

  const recordResolution = useCallback(
    (event: ResolutionEvent, context: RecordContext) => {
      if (historyRef.current.some((entry) => entry.instanceId === event.instanceId)) {
        return;
      }

      const myScore = context.currentUserId
        ? event.scores?.find((score) => score.userId === context.currentUserId) ?? null
        : null;

      const entry: StoryEntry = {
        instanceId: event.instanceId,
        questionText: event.questionText,
        category: context.category,
        difficulty: context.difficulty,
        myAnswer: context.myAnswer,
        correctAnswer: event.correctAnswer,
        wasCorrect: context.myAnswer === null ? null : context.myAnswer === event.correctAnswer,
        pointsChange: myScore?.pointsChange ?? 0,
        myPointsAfter: myScore?.points ?? null,
        recordedAt: Date.now(),
      };

      setHistory((current) => [...current, entry].slice(-MAX_ENTRIES));
    },
    []
  );

  /**
   * Drops the accumulated history for this lobby. Call on a fresh race
   * start so the post-race debrief never mixes questions from two races
   * that happened to share the same lobby code within one tab session.
   */
  const clearStoryline = useCallback(() => {
    setHistory([]);
    try {
      sessionStorage.removeItem(storageKey(lobbyCode));
    } catch {
      /* if storage is unavailable, in-memory reset is enough for this session */
    }
  }, [lobbyCode]);

  return { history, recordResolution, clearStoryline };
}
