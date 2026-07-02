'use client';

/**
 * Parc Fermé Debrief — animated post-race recap.
 *
 * Renders below the winner screen once the chequered flag falls: the player's
 * race retold as a question-by-question timeline, superlative cards computed
 * from data the client already holds, a points-progression sparkline, and a
 * canvas-rendered shareable result card. Display-only.
 */
import { useMemo, useState } from 'react';
import { m } from 'framer-motion';
import { Button, Card, Chip } from '@/components/ui';
import { MotionProvider, MotionEnter } from '@/components/motion';
import { fadeUp, reducedFade, staggerContainer } from '@/lib/motion/presets';
import { useReducedMotion } from '@/lib/motion/useReducedMotion';
import { sortLeaderboardEntries } from '@/lib/useLeaderboardBattles';
import type { StoryEntry } from '@/lib/useRaceStoryline';
import type { LeaderboardEntry } from '@/lib/types';
import { cn } from '@/lib/cn';

interface ParcFermeDebriefProps {
  history: StoryEntry[];
  entries: LeaderboardEntry[];
  currentUserId: string | null;
  lobbyCode: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  OVERTAKE: 'Overtake',
  PIT_WINDOW: 'Pit window',
  GAP_CLOSING: 'Gap closing',
  FINISH_POSITION: 'Final stretch',
};

const DIFFICULTY_WEIGHT: Record<string, number> = { EASY: 1, MEDIUM: 2, HARD: 3 };

interface Superlative {
  emoji: string;
  title: string;
  holder: string;
  detail: string;
}

function buildSuperlatives(
  history: StoryEntry[],
  entries: LeaderboardEntry[],
  currentUserId: string | null
): Superlative[] {
  const result: Superlative[] = [];
  const me = currentUserId ? entries.find((entry) => entry.userId === currentUserId) : null;

  // Clutch Call — your hardest correct answer.
  const clutch = history
    .filter((entry) => entry.wasCorrect === true)
    .sort((a, b) =>
      (DIFFICULTY_WEIGHT[b.difficulty ?? 'EASY'] ?? 1) - (DIFFICULTY_WEIGHT[a.difficulty ?? 'EASY'] ?? 1)
      || b.pointsChange - a.pointsChange
    )[0];
  if (clutch && me) {
    result.push({
      emoji: '🎯',
      title: 'Clutch call',
      holder: me.username,
      detail: `Called "${clutch.correctAnswer}" on a ${(clutch.difficulty ?? 'tough').toLowerCase()} ${CATEGORY_LABEL[clutch.category ?? ''] ?? 'question'} for +${clutch.pointsChange}`,
    });
  }

  const answered = entries.filter((entry) => entry.questionsAnswered > 0);
  if (answered.length > 0) {
    const sharpest = [...answered]
      .filter((entry) => entry.questionsAnswered >= 2)
      .sort((a, b) => b.accuracy - a.accuracy || b.questionsAnswered - a.questionsAnswered)[0];
    if (sharpest) {
      result.push({
        emoji: '🧠',
        title: 'Sharpest caller',
        holder: sharpest.username,
        detail: `${sharpest.accuracy.toFixed(0)}% accuracy over ${sharpest.questionsAnswered} calls`,
      });
    }

    const streakKing = [...answered].sort((a, b) => b.maxStreak - a.maxStreak)[0];
    if (streakKing && streakKing.maxStreak >= 2) {
      result.push({
        emoji: '🔥',
        title: 'Hot streak',
        holder: streakKing.username,
        detail: `${streakKing.maxStreak} correct in a row`,
      });
    }

    const ironWill = [...answered].sort((a, b) => b.questionsAnswered - a.questionsAnswered)[0];
    if (ironWill && ironWill.questionsAnswered >= 3) {
      result.push({
        emoji: '🛞',
        title: 'Never lifted',
        holder: ironWill.username,
        detail: `Answered ${ironWill.questionsAnswered} of the race's calls — most in the lobby`,
      });
    }
  }

  return result.slice(0, 4);
}

function Sparkline({ history }: { history: StoryEntry[] }) {
  const points = history
    .map((entry) => entry.myPointsAfter)
    .filter((value): value is number => value !== null);
  if (points.length < 2) return null;

  const width = 260;
  const height = 56;
  const max = Math.max(...points, 1);
  const step = width / (points.length - 1);
  const path = points
    .map((value, index) => `${index === 0 ? 'M' : 'L'}${(index * step).toFixed(1)},${(height - (value / max) * (height - 6) - 3).toFixed(1)}`)
    .join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-2 h-14 w-full" aria-label="Points progression">
      <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((value, index) => (
        <circle
          key={index}
          cx={index * step}
          cy={height - (value / max) * (height - 6) - 3}
          r="3"
          fill="var(--color-bg-2)"
          stroke="var(--color-accent)"
          strokeWidth="2"
        />
      ))}
    </svg>
  );
}

function AccuracyRing({ accuracy }: { accuracy: number }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, accuracy));
  return (
    <svg viewBox="0 0 64 64" className="h-16 w-16" aria-label={`Accuracy ${clamped.toFixed(0)}%`}>
      <circle cx="32" cy="32" r={radius} fill="none" stroke="var(--color-muted)" strokeWidth="6" />
      <circle
        cx="32"
        cy="32"
        r={radius}
        fill="none"
        stroke={clamped >= 60 ? 'var(--color-go)' : clamped >= 40 ? 'var(--color-warn)' : 'var(--color-accent)'}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped / 100)}
        transform="rotate(-90 32 32)"
      />
      <text
        x="32"
        y="36"
        textAnchor="middle"
        fill="var(--color-fg)"
        fontSize="14"
        fontWeight="700"
        fontFamily="var(--font-barlow-condensed), sans-serif"
      >
        {clamped.toFixed(0)}%
      </text>
    </svg>
  );
}

/** Renders the shareable result card to a canvas and returns it as a PNG blob. */
async function renderShareCard(options: {
  username: string;
  rank: number;
  fieldSize: number;
  points: number;
  accuracy: number;
  maxStreak: number;
  lobbyCode: string;
}): Promise<Blob | null> {
  const { username, rank, fieldSize, points, accuracy, maxStreak, lobbyCode } = options;
  const W = 1080;
  const H = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  try {
    await document.fonts.load('900 120px "Barlow Condensed"');
  } catch {
    /* fall back to system fonts */
  }
  const display = '"Barlow Condensed", "Arial Narrow", sans-serif';

  // Carbon background with the red radial glow from the app theme.
  ctx.fillStyle = '#07090d';
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, -100, 50, W / 2, -100, 900);
  glow.addColorStop(0, 'rgba(255,33,20,0.28)');
  glow.addColorStop(1, 'rgba(255,33,20,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Checkered corner motif.
  const square = 26;
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 8; col++) {
      if ((row + col) % 2 === 0) {
        ctx.fillRect(W - (col + 1) * square, row * square, square, square);
      }
    }
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ff2114';
  ctx.font = `700 40px ${display}`;
  ctx.fillText('M O T O R S P O R T  I Q', W / 2, 140);

  ctx.fillStyle = '#9aa6b8';
  ctx.font = `600 34px ${display}`;
  ctx.fillText(`RACE NIGHT · LOBBY ${lobbyCode.toUpperCase()}`, W / 2, 200);

  ctx.fillStyle = '#f6f8fb';
  ctx.font = `800 130px ${display}`;
  ctx.fillText(username.toUpperCase().slice(0, 14), W / 2, 380);

  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
  ctx.font = `800 74px ${display}`;
  ctx.fillStyle = rank <= 3 ? '#ffd400' : '#9aa6b8';
  ctx.fillText(`${medal ? `${medal} ` : ''}P${rank} OF ${fieldSize}`, W / 2, 490);

  // Stat blocks.
  const stats: Array<[string, string]> = [
    [String(points), 'POINTS'],
    [`${accuracy.toFixed(0)}%`, 'ACCURACY'],
    [String(maxStreak), 'BEST STREAK'],
  ];
  const blockW = 280;
  const gap = 30;
  const totalW = stats.length * blockW + (stats.length - 1) * gap;
  let x = (W - totalW) / 2;
  for (const [value, label] of stats) {
    ctx.fillStyle = '#12161f';
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, 580, blockW, 240, 24);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#f6f8fb';
    ctx.font = `800 96px ${display}`;
    ctx.fillText(value, x + blockW / 2, 710);
    ctx.fillStyle = '#5d6878';
    ctx.font = `700 30px ${display}`;
    ctx.fillText(label, x + blockW / 2, 770);
    x += blockW + gap;
  }

  ctx.fillStyle = '#ff2114';
  ctx.fillRect(W / 2 - 260, 900, 520, 6);
  ctx.fillStyle = '#9aa6b8';
  ctx.font = `600 34px ${display}`;
  ctx.fillText('PREDICT THE RACE · BEAT YOUR MATES', W / 2, 970);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export default function ParcFermeDebrief({ history, entries, currentUserId, lobbyCode }: ParcFermeDebriefProps) {
  const reduced = useReducedMotion();
  const [shareState, setShareState] = useState<'idle' | 'working' | 'done'>('idle');

  const ranked = useMemo(() => sortLeaderboardEntries(entries), [entries]);
  const myIndex = currentUserId ? ranked.findIndex((entry) => entry.userId === currentUserId) : -1;
  const me = myIndex >= 0 ? ranked[myIndex] : null;

  const superlatives = useMemo(
    () => buildSuperlatives(history, entries, currentUserId),
    [history, entries, currentUserId]
  );

  const handleShareCard = async () => {
    if (!me || shareState === 'working') return;
    setShareState('working');

    let objectUrl: string | null = null;
    let succeeded = false;
    try {
      const blob = await renderShareCard({
        username: me.username,
        rank: myIndex + 1,
        fieldSize: ranked.length,
        points: me.points,
        accuracy: me.accuracy,
        maxStreak: me.maxStreak,
        lobbyCode,
      });
      if (!blob) {
        return;
      }

      const file = new File([blob], 'motorsport-iq-result.png', { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        // Users cancelling the native share sheet throws AbortError — treat
        // as "not shared" without surfacing an error.
        await navigator.share({ files: [file], title: 'Motorsport IQ' });
      } else {
        objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = 'motorsport-iq-result.png';
        link.click();
      }
      succeeded = true;
    } catch {
      /* renderShareCard failure, share sheet abort, or download error —
         we quietly return the button to idle in the finally block. */
    } finally {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      if (succeeded) {
        setShareState('done');
        setTimeout(() => setShareState('idle'), 2500);
      } else {
        setShareState('idle');
      }
    }
  };

  if (history.length === 0 && superlatives.length === 0) {
    return null;
  }

  return (
    <MotionProvider>
      <Card tone="elevated" className="relative overflow-hidden">
        <MotionEnter variants={reduced ? reducedFade : staggerContainer(0.1, 0.2)}>
          {/* Header strip */}
          <m.div
            variants={reduced ? reducedFade : fadeUp}
            className="flex items-center gap-2.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-muted)] px-3.5 py-2"
          >
            <span className="h-2 w-2 rounded-full bg-[var(--color-accent)]" aria-hidden />
            <span className="font-display text-sm font-bold uppercase tracking-[0.22em] text-[var(--color-muted-fg)]">
              Parc Fermé · Race debrief
            </span>
          </m.div>

          {/* Personal summary */}
          {me && (
            <m.div
              variants={reduced ? reducedFade : fadeUp}
              className="mt-4 flex items-center gap-4 rounded-[var(--radius-sm)] bg-[var(--color-muted)] p-4"
            >
              <AccuracyRing accuracy={me.accuracy} />
              <div className="min-w-0 flex-1">
                <p className="font-display text-2xl font-bold uppercase leading-none tracking-tight">
                  P{myIndex + 1}
                  <span className="ml-2 text-base font-semibold text-[var(--color-muted-fg)]">
                    of {ranked.length} · {me.points} pts
                  </span>
                </p>
                <p className="mt-1 text-xs text-[var(--color-muted-fg)]">
                  {me.correctAnswers} right · {me.wrongAnswers} wrong
                  {me.maxStreak > 1 ? ` · best streak ${me.maxStreak}` : ''}
                </p>
                <Sparkline history={history} />
              </div>
            </m.div>
          )}

          {/* Superlatives */}
          {superlatives.length > 0 && (
            <m.div variants={reduced ? reducedFade : fadeUp} className="mt-4 grid gap-2.5 sm:grid-cols-2">
              {superlatives.map((item) => (
                <div
                  key={item.title}
                  className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-panel)] p-3.5"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-faint-fg)]">
                    <span className="mr-1.5" aria-hidden>{item.emoji}</span>
                    {item.title}
                  </p>
                  <p className="mt-1.5 truncate font-display text-lg font-bold uppercase leading-tight">
                    {item.holder}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-muted-fg)]">{item.detail}</p>
                </div>
              ))}
            </m.div>
          )}

          {/* Question timeline */}
          {history.length > 0 && (
            <m.div variants={reduced ? reducedFade : fadeUp} className="mt-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-faint-fg)]">
                Your race, call by call
              </p>
              <ol className="mt-2.5 space-y-0">
                {history.map((entry, index) => {
                  const verdictColor = entry.wasCorrect === true
                    ? 'var(--color-go)'
                    : entry.wasCorrect === false
                      ? 'var(--color-danger)'
                      : 'var(--color-faint-fg)';
                  return (
                    <li key={entry.instanceId} className="relative flex gap-3 pb-4 last:pb-0">
                      {/* Timeline spine */}
                      {index < history.length - 1 && (
                        <span
                          className="absolute left-[5px] top-4 h-full w-px bg-[var(--color-border)]"
                          aria-hidden
                        />
                      )}
                      <span
                        className="relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2"
                        style={{ borderColor: verdictColor, backgroundColor: entry.wasCorrect === null ? 'transparent' : verdictColor }}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium leading-snug text-[var(--color-fg)]">
                          {entry.questionText}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                          {entry.category && (
                            <span className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-[var(--color-faint-fg)]">
                              {CATEGORY_LABEL[entry.category] ?? entry.category}
                            </span>
                          )}
                          <span
                            className={cn(
                              'text-xs font-semibold',
                              entry.wasCorrect === true && 'text-[var(--color-go)]',
                              entry.wasCorrect === false && 'text-[var(--color-danger)]',
                              entry.wasCorrect === null && 'text-[var(--color-faint-fg)]'
                            )}
                          >
                            {entry.wasCorrect === null
                              ? `No call · answer was ${entry.correctAnswer}`
                              : entry.wasCorrect
                                ? `Called ${entry.myAnswer} — right`
                                : `Called ${entry.myAnswer} — it was ${entry.correctAnswer}`}
                          </span>
                          {entry.pointsChange > 0 && (
                            <span className="font-display text-xs font-bold text-[var(--color-go)]">
                              +{entry.pointsChange}
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </m.div>
          )}

          {/* Share card */}
          {me && (
            <m.div
              variants={reduced ? reducedFade : fadeUp}
              className="mt-5 flex flex-col items-start gap-2 border-t border-[var(--color-border)] pt-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-display text-base font-bold uppercase tracking-tight">Take it to the group chat</p>
                <p className="text-xs text-[var(--color-muted-fg)]">
                  Generates a result card with your finish, points and accuracy.
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleShareCard()}
                disabled={shareState === 'working'}
                className="shrink-0"
              >
                {shareState === 'working'
                  ? 'Rendering…'
                  : shareState === 'done'
                    ? 'Shared!'
                    : 'Share result card'}
              </Button>
            </m.div>
          )}

          {history.length === 0 && (
            <m.p variants={reduced ? reducedFade : fadeUp} className="mt-4 text-sm text-[var(--color-muted-fg)]">
              <Chip tone="info" className="mr-2">Heads up</Chip>
              No question history recorded on this device — the timeline fills in when you play a race from the start.
            </m.p>
          )}
        </MotionEnter>
      </Card>
    </MotionProvider>
  );
}
