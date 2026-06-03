'use client';

import { Card } from '@/components/ui';
import type { LeaderboardEntry } from '@/lib/types';
import { cn } from '@/lib/cn';

interface LeaderboardProps {
  entries: LeaderboardEntry[];
  currentUserId?: string;
  maxEntries?: number;
}

const RANK_ACCENT = ['#ffd400', '#cfd6e0', '#d98a4a'];

export default function Leaderboard({ entries, currentUserId, maxEntries = 10 }: LeaderboardProps) {
  const sortedEntries = [...entries]
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
      return b.maxStreak - a.maxStreak;
    })
    .slice(0, maxEntries);

  return (
    <Card tone="default" className="h-full">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-xl font-semibold uppercase tracking-tight">Leaderboard</h3>
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-faint-fg)]">
          {sortedEntries.length} {sortedEntries.length === 1 ? 'driver' : 'drivers'}
        </span>
      </div>

      {sortedEntries.length === 0 ? (
        <p className="mt-4 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)] p-5 text-center text-sm text-[var(--color-muted-fg)]">
          No scores yet — answer a question to get on the board.
        </p>
      ) : (
        <ol className="mt-3 space-y-1.5">
          {sortedEntries.map((entry, index) => {
            const rank = index + 1;
            const isCurrentUser = entry.userId === currentUserId;
            const medal = rank <= 3 ? RANK_ACCENT[rank - 1] : null;

            return (
              <li
                key={entry.userId}
                className={cn(
                  'flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 transition-colors',
                  isCurrentUser
                    ? 'bg-[var(--color-accent-soft)] ring-1 ring-[var(--color-accent)]/50'
                    : 'bg-[var(--color-muted)]'
                )}
              >
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold"
                  style={
                    medal
                      ? { backgroundColor: medal, color: '#0a0d12' }
                      : { color: 'var(--color-faint-fg)' }
                  }
                >
                  {rank}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-base font-semibold uppercase leading-tight">
                    {entry.username}
                    {isCurrentUser && <span className="ml-1.5 text-[var(--color-accent)]">· you</span>}
                  </p>
                  <p className="text-xs text-[var(--color-muted-fg)]">
                    {entry.accuracy.toFixed(0)}% accuracy
                    {entry.streak > 1 ? ` · ${entry.streak} streak` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <span className="font-display text-xl font-bold leading-none">{entry.points}</span>
                  <span className="ml-1 text-[0.65rem] font-medium uppercase text-[var(--color-faint-fg)]">pts</span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
