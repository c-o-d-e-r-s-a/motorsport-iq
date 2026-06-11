'use client';

import { useState, useEffect, useRef } from 'react';
import type { RaceSnapshotEvent } from '@/lib/types';
import { Chip } from '@/components/ui';
import RaceConditionBadge from '@/components/RaceConditionBadge';

interface RaceHudProps {
  snapshot: RaceSnapshotEvent | null;
  raceCompletedLap: number | null;
  feedStalled: boolean;
  connected: boolean;
  highlightTrackStatus?: boolean;
}

/**
 * The SignalR feed arrives ~3s after track events while the F1TV broadcast has
 * a 30-60s delay. To keep the displayed lap number in sync with what viewers
 * see on TV, we hold the new lap number for 30 seconds before surfacing it.
 * Game logic on the backend always runs on the real (undelayed) lap number.
 */
const BROADCAST_LAP_DELAY_MS = 30_000;

export default function RaceHud({
  snapshot,
  raceCompletedLap,
  feedStalled,
  connected,
  highlightTrackStatus = false,
}: RaceHudProps) {
  const hasCompleted = raceCompletedLap !== null;

  const [displayedLap, setDisplayedLap] = useState<number | null>(null);
  const lapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestLapRef = useRef<number | null>(null);

  useEffect(() => {
    const newLap = snapshot?.lapNumber ?? null;
    if (newLap === null) return;

    latestLapRef.current = newLap;

    if (displayedLap === null) {
      setDisplayedLap(newLap);
      return;
    }

    if (newLap <= displayedLap) return;

    if (lapTimerRef.current !== null) {
      clearTimeout(lapTimerRef.current);
    }

    lapTimerRef.current = setTimeout(() => {
      lapTimerRef.current = null;
      setDisplayedLap(latestLapRef.current ?? newLap);
    }, BROADCAST_LAP_DELAY_MS);
  // Only re-run when the actual lap number from the server changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.lapNumber]);

  useEffect(() => {
    return () => {
      if (lapTimerRef.current !== null) {
        clearTimeout(lapTimerRef.current);
      }
    };
  }, []);

  const lapToShow = displayedLap ?? snapshot?.lapNumber ?? null;

  return (
    <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {!connected && <Chip tone="warn" className="animate-flash">Reconnecting</Chip>}

      {snapshot && (
        <>
          <Chip tone="neutral">
            <span className="text-[var(--color-faint-fg)]">Lap</span>
            <span className="font-bold text-[var(--color-fg)]">
              {hasCompleted
                ? raceCompletedLap
                : `${lapToShow}${snapshot.totalLaps ? `/${snapshot.totalLaps}` : ''}`}
            </span>
          </Chip>

          {hasCompleted ? (
            <Chip tone="accent">🏁 Finished</Chip>
          ) : (
            <RaceConditionBadge status={snapshot.trackStatus} highlighted={highlightTrackStatus} />
          )}

          <Chip tone="neutral">
            <span className="text-[var(--color-faint-fg)]">P1</span>
            <span className="font-bold text-[var(--color-fg)]">{snapshot.leader}</span>
          </Chip>

          {snapshot.sessionMode === 'replay' && !hasCompleted && (
            <Chip tone="info">Replay {snapshot.replaySpeed}×</Chip>
          )}
        </>
      )}

      {feedStalled && <Chip tone="danger">Feed stalled</Chip>}
    </div>
  );
}
