'use client';

import { useMemo, useEffect, useState } from 'react';

interface CountdownTimerProps {
  deadline: Date | string;
  onExpire?: () => void;
  size?: 'sm' | 'md' | 'lg';
  totalDurationMs?: number;
}

export default function CountdownTimer({
  deadline,
  onExpire,
  size = 'md',
  totalDurationMs = 45000,
}: CountdownTimerProps) {
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isExpired, setIsExpired] = useState(false);

  const deadlineTime = useMemo(
    () => (typeof deadline === 'string' ? new Date(deadline).getTime() : deadline.getTime()),
    [deadline]
  );

  useEffect(() => {
    const updateTimer = () => {
      const remaining = Math.max(0, deadlineTime - Date.now());

      setTimeRemaining(remaining);
      setIsExpired(remaining === 0);

      if (remaining === 0 && onExpire) {
        onExpire();
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 100);
    return () => clearInterval(interval);
  }, [deadlineTime, onExpire]);

  const progress = Math.max(0, Math.min(1, timeRemaining / totalDurationMs));
  const seconds = Math.ceil(timeRemaining / 1000);
  const isUrgent = seconds <= 10 && !isExpired;

  const dims = size === 'sm' ? 64 : size === 'md' ? 96 : 132;
  const stroke = size === 'sm' ? 5 : size === 'md' ? 7 : 9;
  const radius = (dims - stroke) / 2 - 1;
  const circumference = 2 * Math.PI * radius;
  const dashoffset = circumference * (1 - progress);

  const color = isExpired
    ? 'var(--color-accent)'
    : progress > 0.5
      ? 'var(--color-go)'
      : progress > 0.22
        ? 'var(--color-warn)'
        : 'var(--color-accent)';

  const numberClass = size === 'sm' ? 'text-xl' : size === 'md' ? 'text-4xl' : 'text-6xl';

  return (
    <div
      className={`relative inline-flex items-center justify-center rounded-full ${isUrgent ? 'animate-pulse-ring' : ''}`}
      style={{ width: dims, height: dims }}
      role="timer"
      aria-label={`${seconds} seconds remaining`}
    >
      <svg width={dims} height={dims} className="-rotate-90">
        <circle
          cx={dims / 2}
          cy={dims / 2}
          r={radius}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={stroke}
        />
        <circle
          cx={dims / 2}
          cy={dims / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashoffset}
          className="transition-[stroke-dashoffset,stroke] duration-100 ease-linear"
          style={{ filter: `drop-shadow(0 0 6px ${color})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center font-display leading-none">
        <span className={`font-bold ${numberClass}`} style={{ color }}>
          {seconds}
        </span>
        {size === 'lg' && (
          <span className="mt-1 text-[0.6rem] font-medium uppercase tracking-[0.24em] text-[var(--color-faint-fg)]">
            sec
          </span>
        )}
      </div>
    </div>
  );
}
