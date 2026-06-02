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

  const totalDuration = totalDurationMs;
  const progress = Math.max(0, Math.min(1, timeRemaining / totalDuration));
  const seconds = Math.ceil(timeRemaining / 1000);

  const radius = size === 'sm' ? 30 : size === 'md' ? 45 : 60;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progress);

  const getColor = () => {
    if (progress > 0.5) return '#22c55e';
    if (progress > 0.25) return '#f59e0b';
    return 'var(--color-accent)';
  };

  const textClass = size === 'sm' ? 'text-lg' : size === 'md' ? 'text-2xl' : 'text-4xl';

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={radius * 2 + 10} height={radius * 2 + 10} className="-rotate-90 transform">
        <circle
          cx={radius + 5}
          cy={radius + 5}
          r={radius}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth="6"
        />
        <circle
          cx={radius + 5}
          cy={radius + 5}
          r={radius}
          fill="none"
          stroke={isExpired ? 'var(--color-accent)' : getColor()}
          strokeWidth="6"
          strokeLinecap="butt"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className="transition-all duration-100 ease-linear"
        />
      </svg>
      <div className={`absolute inset-0 flex items-center justify-center font-display ${textClass}`}>
        <span style={{ color: isExpired ? 'var(--color-accent)' : getColor() }}>{seconds}</span>
      </div>
    </div>
  );
}
