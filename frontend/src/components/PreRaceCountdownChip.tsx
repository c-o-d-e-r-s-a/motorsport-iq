'use client';

import { Chip } from '@/components/ui';
import { useRaceStartCountdown } from '@/lib/preRaceCountdown';

interface PreRaceCountdownChipProps {
  dateStart: string;
}

export default function PreRaceCountdownChip({ dateStart }: PreRaceCountdownChipProps) {
  const countdown = useRaceStartCountdown(dateStart);

  return (
    <Chip tone="warn" className="normal-case tabular-nums tracking-normal">
      {/* Re-key per tick so each second settles in (mq-tick, killed by reduced-motion) */}
      <span key={countdown} className="animate-tick inline-block">
        {countdown}
      </span>
    </Chip>
  );
}
