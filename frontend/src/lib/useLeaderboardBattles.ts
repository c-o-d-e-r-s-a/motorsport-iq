'use client';

/**
 * Box Box Broadcast — display-only leaderboard battle detection.
 *
 * Diffs successive leaderboard updates to surface "overtake" moments between
 * players (someone gains points and jumps past someone else) plus a persistent
 * rival read-out (the player directly ahead of / behind you). Purely additive:
 * the server remains the sole authority on scores — this only watches them.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LeaderboardEntry } from '@/lib/types';

export interface OvertakeBroadcastEvent {
  id: string;
  attackerId: string;
  attackerName: string;
  victimId: string | null;
  victimName: string | null;
  newRank: number;
  isLeadChange: boolean;
}

export interface RivalInfo {
  /** hunting — someone is ahead of you; leading — you are P1 with a chaser. */
  mode: 'hunting' | 'leading';
  name: string;
  /** Points between you and them, always >= 0. */
  gap: number;
  myRank: number;
}

export interface RankedInfo {
  rank: number;
  points: number;
  username: string;
}

export interface LeaderboardDiff {
  /** Rank movement per user since the previous update (positive = moved up). */
  deltas: Record<string, number>;
  overtakes: Array<Omit<OvertakeBroadcastEvent, 'id'>>;
}

/**
 * Pure diff between two ranked leaderboard states. An overtake requires both
 * a rank gain and a points gain — rank shifts caused purely by players
 * leaving the lobby don't earn a broadcast graphic.
 */
export function diffLeaderboards(
  prev: Map<string, RankedInfo>,
  next: Map<string, RankedInfo>
): LeaderboardDiff {
  const deltas: Record<string, number> = {};
  const overtakes: LeaderboardDiff['overtakes'] = [];

  for (const [userId, info] of next) {
    const before = prev.get(userId);
    if (!before) continue;

    const delta = before.rank - info.rank;
    if (delta !== 0) {
      deltas[userId] = delta;
    }

    if (delta > 0 && info.points > before.points) {
      let victimId: string | null = null;
      let victimName: string | null = null;
      for (const [otherId, otherBefore] of prev) {
        if (otherId === userId) continue;
        const otherNow = next.get(otherId);
        if (!otherNow) continue;
        if (otherBefore.rank === info.rank && otherNow.rank > info.rank) {
          victimId = otherId;
          victimName = otherNow.username;
          break;
        }
      }

      overtakes.push({
        attackerId: userId,
        attackerName: info.username,
        victimId,
        victimName,
        newRank: info.rank,
        isLeadChange: info.rank === 1,
      });
    }
  }

  return { deltas, overtakes };
}

/** The player directly ahead of you (hunting) or your closest chaser (leading). */
export function computeRival(
  entries: LeaderboardEntry[],
  currentUserId: string | null
): RivalInfo | null {
  if (!currentUserId) return null;
  const sorted = sortLeaderboardEntries(entries);
  const myIndex = sorted.findIndex((entry) => entry.userId === currentUserId);
  if (myIndex > 0) {
    const ahead = sorted[myIndex - 1];
    return {
      mode: 'hunting',
      name: ahead.username,
      gap: ahead.points - sorted[myIndex].points,
      myRank: myIndex + 1,
    };
  }
  if (myIndex === 0 && sorted.length > 1) {
    return {
      mode: 'leading',
      name: sorted[1].username,
      gap: sorted[0].points - sorted[1].points,
      myRank: 1,
    };
  }
  return null;
}

/** Must mirror the sort used by Leaderboard.tsx / WinnerScreen.tsx exactly. */
export function sortLeaderboardEntries(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
    return b.maxStreak - a.maxStreak;
  });
}

const DELTA_LINGER_MS = 6000;
const MAX_QUEUED_EVENTS = 4;

export function useLeaderboardBattles(
  entries: LeaderboardEntry[],
  currentUserId: string | null
) {
  const prevRef = useRef<Map<string, RankedInfo> | null>(null);
  const eventSeq = useRef(0);
  const deltaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [events, setEvents] = useState<OvertakeBroadcastEvent[]>([]);
  const [rankDeltas, setRankDeltas] = useState<Record<string, number>>({});

  useEffect(() => {
    const sorted = sortLeaderboardEntries(entries);
    const next = new Map<string, RankedInfo>(
      sorted.map((entry, index) => [
        entry.userId,
        { rank: index + 1, points: entry.points, username: entry.username },
      ])
    );
    const prev = prevRef.current;
    prevRef.current = next;
    if (!prev || prev.size === 0) {
      return;
    }

    const { deltas, overtakes } = diffLeaderboards(prev, next);
    const detected: OvertakeBroadcastEvent[] = overtakes.map((overtake) => ({
      ...overtake,
      id: `${overtake.attackerId}-${++eventSeq.current}`,
    }));

    if (Object.keys(deltas).length > 0) {
      setRankDeltas(deltas);
      if (deltaTimerRef.current) {
        clearTimeout(deltaTimerRef.current);
      }
      deltaTimerRef.current = setTimeout(() => setRankDeltas({}), DELTA_LINGER_MS);
    }

    if (detected.length > 0) {
      // Lead changes first, then battles involving the local player.
      detected.sort((a, b) => {
        const score = (e: OvertakeBroadcastEvent) =>
          (e.isLeadChange ? 2 : 0)
          + (e.attackerId === currentUserId || e.victimId === currentUserId ? 1 : 0);
        return score(b) - score(a);
      });
      setEvents((queue) => [...queue, ...detected].slice(0, MAX_QUEUED_EVENTS));
    }
  }, [entries, currentUserId]);

  useEffect(() => () => {
    if (deltaTimerRef.current) {
      clearTimeout(deltaTimerRef.current);
    }
  }, []);

  const dismissEvent = useCallback((id: string) => {
    setEvents((queue) => queue.filter((event) => event.id !== id));
  }, []);

  /**
   * Wipes battle state so the next leaderboard update becomes the new
   * baseline. Call this on a genuine race reset (e.g. Lights Out for a
   * fresh race) so the client doesn't broadcast "overtakes" for scores
   * accumulated in a prior session.
   */
  const resetBattles = useCallback(() => {
    prevRef.current = null;
    if (deltaTimerRef.current) {
      clearTimeout(deltaTimerRef.current);
      deltaTimerRef.current = null;
    }
    setEvents([]);
    setRankDeltas({});
  }, []);

  // Rival is derived, not stored — recomputed only when the inputs actually
  // change, so RivalBattleChip doesn't reanimate on unrelated re-renders.
  const rival = useMemo(() => computeRival(entries, currentUserId), [entries, currentUserId]);

  return { events, dismissEvent, resetBattles, rankDeltas, rival };
}
