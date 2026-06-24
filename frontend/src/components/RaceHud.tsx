'use client';

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

export default function RaceHud({
  snapshot,
  raceCompletedLap,
  feedStalled,
  connected,
  highlightTrackStatus = false,
}: RaceHudProps) {
  const hasCompleted = raceCompletedLap !== null;
  const lapToShow = snapshot?.lapNumber ?? null;
  const yellowSectors = snapshot?.localYellowSectors ?? [];
  // Localized sector yellows are informational only — show them alongside a
  // green track, never on top of a global neutralization (SC/VSC/RED) which the
  // main badge already conveys (and during which the backend clears them).
  const showSectorYellow =
    !hasCompleted && snapshot?.trackStatus === 'GREEN' && yellowSectors.length > 0;

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

          {showSectorYellow && (
            <Chip tone="warn" title={`Localized yellow flag in sector ${yellowSectors.join(', ')}`}>
              <span className="animate-flash">🟡</span>
              <span className="font-semibold">
                Sector {yellowSectors.length > 1 ? 'Yellows' : 'Yellow'} {yellowSectors.join(', ')}
              </span>
            </Chip>
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
