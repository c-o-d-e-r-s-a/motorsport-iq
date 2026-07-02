'use client';

import { Chip } from '@/components/ui';
import QuestionContextPanel from '@/components/QuestionContext';
import { CATEGORY_LABELS } from '@/lib/categoryLabels';
import { cn } from '@/lib/cn';
import { type Difficulty, type QuestionCategory, type QuestionContext } from '@/lib/types';

interface QuestionCardProps {
  questionText: string;
  category: QuestionCategory;
  difficulty: Difficulty;
  instanceId: string;
  questionContext?: QuestionContext;
  onSubmit: (answer: 'YES' | 'NO') => void;
  disabled?: boolean;
  answered?: 'YES' | 'NO' | null;
}

const CATEGORY_TONE: Record<QuestionCategory, 'accent' | 'info' | 'warn' | 'go'> = {
  OVERTAKE: 'accent',
  PIT_WINDOW: 'info',
  GAP_CLOSING: 'warn',
  FINISH_POSITION: 'go',
};

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  EASY: 'Easy',
  MEDIUM: 'Medium',
  HARD: 'Hard',
};

export default function QuestionCard({
  questionText,
  category,
  difficulty,
  questionContext,
  onSubmit,
  disabled = false,
  answered = null,
}: QuestionCardProps) {
  const locked = disabled || answered !== null;

  return (
    <div className="flex w-full flex-col">
      {/* Entrance choreography (runs once per mount — parent keys by instanceId):
          chip stamps down → question reads → answers land last. */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <Chip tone={CATEGORY_TONE[category]} className="animate-stamp-in [animation-delay:180ms]">
          {CATEGORY_LABELS[category]}
        </Chip>
        <span className="animate-fade-in delay-3 text-xs font-medium uppercase tracking-wide text-[var(--color-faint-fg)]">
          {DIFFICULTY_LABELS[difficulty]}
        </span>
      </div>

      <h2 className="animate-fade-up delay-1 font-display text-[1.9rem] font-semibold leading-[1.08] tracking-tight text-[var(--color-fg)] sm:text-4xl">
        {questionText}
      </h2>

      {questionContext && (
        <QuestionContextPanel context={questionContext} category={category} />
      )}

      <div className="animate-fade-up delay-4 mt-7 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onSubmit('YES')}
          disabled={locked}
          className={cn(
            'flex h-[72px] items-center justify-center rounded-[var(--radius)] font-display text-2xl font-bold uppercase tracking-wide transition-all duration-[var(--dur-fast)] ease-[var(--ease-out)] active:scale-[0.97]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-go)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]',
            answered === 'YES'
              ? 'animate-confirm bg-[var(--color-go)] text-[#04130b] shadow-[0_8px_30px_var(--color-go-soft)]'
              : answered === 'NO'
                ? 'bg-[var(--color-muted)] text-[var(--color-faint-fg)] opacity-50'
                : 'bg-[var(--color-go)] text-[#04130b] hover:brightness-110 disabled:opacity-60'
          )}
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => onSubmit('NO')}
          disabled={locked}
          className={cn(
            'flex h-[72px] items-center justify-center rounded-[var(--radius)] font-display text-2xl font-bold uppercase tracking-wide transition-all duration-[var(--dur-fast)] ease-[var(--ease-out)] active:scale-[0.97]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]',
            answered === 'NO'
              ? 'animate-confirm bg-[var(--color-accent)] text-white shadow-[var(--shadow-accent)]'
              : answered === 'YES'
                ? 'bg-[var(--color-muted)] text-[var(--color-faint-fg)] opacity-50'
                : 'border border-[var(--color-border-strong)] bg-[var(--color-elevated)] text-[var(--color-fg)] hover:border-[var(--color-accent)] disabled:opacity-60'
          )}
        >
          No
        </button>
      </div>

      {answered && (
        <p className="animate-fade-up mt-4 text-center text-sm text-[var(--color-muted-fg)]">
          Locked in: <span className="font-semibold text-[var(--color-fg)]">{answered}</span>
        </p>
      )}
    </div>
  );
}
