'use client';

import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import QuestionCard from '@/components/QuestionCard';
import CountdownTimer from '@/components/CountdownTimer';
import Leaderboard from '@/components/Leaderboard';

import RaceConditionBadge from '@/components/RaceConditionBadge';
import TireStats from '@/components/TireStats';
import WinnerScreen from '@/components/WinnerScreen';
import { getSocketClient } from '@/lib/socket';
import { apiFetch } from '@/lib/api';
import { useQuestionSound } from '@/hooks/useQuestionSound';
import { useAnswerOutcomeSounds } from '@/hooks/useAnswerOutcomeSounds';
import {
  SERVER_EVENTS,
  type CreateProblemReportInput,
  type LeaderboardEntry,
  type LobbyState,
  type ProblemReportReason,
  type QuestionEvent,
  type QuestionStateEvent,
  type QuestionTextUpdateEvent,
  type QuestionState,
  type RaceSnapshotEvent,
  type ResolutionEvent,
  type ServerErrorEvent,
  type StatHintKey,
} from '@/lib/types';
import { Button, Card, SectionLabel, ThemeToggle } from '@/components/ui';

const REPORT_REASON_OPTIONS: Array<{ value: ProblemReportReason; label: string }> = [
  { value: 'WRONG_ANSWER', label: 'Wrong Answer' },
  { value: 'BAD_EXPLANATION', label: 'Bad Explanation' },
  { value: 'UNCLEAR_QUESTION', label: 'Unclear Question' },
  { value: 'TELEMETRY_MISMATCH', label: 'Telemetry Mismatch' },
  { value: 'OTHER', label: 'Other' },
];

export default function GamePage() {
  const params = useParams();
  const router = useRouter();
  const lobbyCode = params.code as string;

  const [lobbyState, setLobbyState] = useState<LobbyState | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<QuestionEvent | null>(null);
  const [questionState, setQuestionState] = useState<QuestionState | null>(null);
  const [submittedAnswers, setSubmittedAnswers] = useState<Record<string, 'YES' | 'NO'>>({});
  const [isProcessingAnswer, setIsProcessingAnswer] = useState(false);
  const [resolution, setResolution] = useState<ResolutionEvent | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [raceSnapshot, setRaceSnapshot] = useState<RaceSnapshotEvent | null>(null);
  const [raceCompletedLap, setRaceCompletedLap] = useState<number | null>(null);
  const [suggestedStatKeys, setSuggestedStatKeys] = useState<StatHintKey[]>([]);
  const [feedStalled, setFeedStalled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState<ProblemReportReason>('WRONG_ANSWER');
  const [reportNote, setReportNote] = useState('');
  const [isReportFormOpen, setIsReportFormOpen] = useState(false);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [reportSuccess, setReportSuccess] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [isSocketConnected, setIsSocketConnected] = useState<boolean>(() => getSocketClient().isConnected());
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);
  const [localCorrectAnswers, setLocalCorrectAnswers] = useState<number>(0);
  const [joinUsername, setJoinUsername] = useState(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('msp_username') ?? '';
  });
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [isJoining, setIsJoining] = useState(false);

  const { playSound } = useQuestionSound('/sounds/question-alert.mp3');
  const { playCorrectSound, playWrongSound } = useAnswerOutcomeSounds();

  // Track processed resolutions to prevent flickering from duplicate events
  const processedResolutionIds = useRef<Set<string>>(new Set());
  const acknowledgedAnswerIds = useRef<Set<string>>(new Set());
  const currentQuestionRef = useRef<QuestionEvent | null>(null);
  const questionStateRef = useRef<QuestionState | null>(null);
  const submittedAnswersRef = useRef<Record<string, 'YES' | 'NO'>>({});
  const joinUsernameRef = useRef(joinUsername);

  const currentUserId = typeof window !== 'undefined' ? localStorage.getItem('msp_user_id') : null;
  useEffect(() => {
    currentQuestionRef.current = currentQuestion;
  }, [currentQuestion]);

  useEffect(() => {
    questionStateRef.current = questionState;
  }, [questionState]);

  useEffect(() => {
    submittedAnswersRef.current = submittedAnswers;
  }, [submittedAnswers]);

  useEffect(() => {
    joinUsernameRef.current = joinUsername;
  }, [joinUsername]);

  const hydrateQuestionFromLobby = useEffectEvent((state: LobbyState) => {
    const question = state.currentQuestion;
    if (!question) {
      setCurrentQuestion(null);
      setSuggestedStatKeys([]);
      return;
    }

    setCurrentQuestion((previous) => {
      const fallbackCategory = previous?.instanceId === question.id ? previous.category : 'GAP_CLOSING';
      const fallbackDifficulty = previous?.instanceId === question.id ? previous.difficulty : 'MEDIUM';
      const triggeredAt = typeof question.triggeredAt === 'string'
        ? question.triggeredAt
        : new Date(question.triggeredAt).toISOString();

      // Use server's answerDeadline if available, fallback to client calculation
      const answerDeadline = question.answerDeadline
        ? (typeof question.answerDeadline === 'string'
            ? question.answerDeadline
            : new Date(question.answerDeadline).toISOString())
        : undefined;

      return {
        instanceId: question.id,
        questionId: question.questionId,
        questionText: question.questionText ?? previous?.questionText ?? 'Question in progress',
        category: fallbackCategory,
        difficulty: fallbackDifficulty,
        windowSize: question.windowSize,
        triggeredAt,
        answerDeadline,
        state: question.state,
        suggestedStatKeys: question.suggestedStatKeys ?? previous?.suggestedStatKeys ?? [],
      };
    });

    setQuestionState(question.state);
    setSuggestedStatKeys(question.suggestedStatKeys ?? []);
    setResolution(null);
    if (question.state !== 'LIVE') {
      setIsProcessingAnswer(false);
    }
  });

  const handleSocketError = useEffectEvent(({ message, code }: ServerErrorEvent) => {
    const normalizedMessage = message.toLowerCase();
    const isSessionExpired = code === 'SESSION_EXPIRED'
      || normalizedMessage.includes('user not in any lobby')
      || normalizedMessage.includes('user not found')
      || normalizedMessage.includes('session expired');

    if (isSessionExpired) {
      localStorage.removeItem('msp_user_id');
      setShowJoinForm(true);
      setConnectionNotice('Enter your driver name to rejoin this session.');
      return;
    }

    const currentInstanceId = currentQuestion?.instanceId ?? null;
    const hasLocalSubmission = currentInstanceId
      ? Boolean(submittedAnswers[currentInstanceId])
      : false;
    const isStaleSubmissionError = (
      normalizedMessage.includes('answer period has ended')
      || normalizedMessage.includes('question not found')
      || normalizedMessage.includes('already answered')
    ) && (isProcessingAnswer || hasLocalSubmission);

    if (isStaleSubmissionError) {
      if (currentInstanceId && !acknowledgedAnswerIds.current.has(currentInstanceId)) {
        setSubmittedAnswers((current) => {
          const next = { ...current };
          delete next[currentInstanceId];
          return next;
        });
      }
      setIsProcessingAnswer(false);
      return;
    }

    if (isProcessingAnswer && currentQuestion) {
      setSubmittedAnswers((current) => {
        const next = { ...current };
        delete next[currentQuestion.instanceId];
        return next;
      });
      setIsProcessingAnswer(false);
    }
    setError(message);
  });

  useEffect(() => {
    const socket = getSocketClient();
    socket.connect();

    const unsubscribers = [
      socket.on('connected', () => {
        setIsSocketConnected(true);
        setConnectionNotice(null);
        const storedUserId = localStorage.getItem('msp_user_id');
        if (storedUserId) {
          socket.reconnectLobby(storedUserId);
          return;
        }

        socket.lookupLobby(lobbyCode);
      }),
      socket.on(SERVER_EVENTS.LOBBY_LOOKUP, () => {
        if (!localStorage.getItem('msp_user_id')) {
          setShowJoinForm(true);
        }
      }),
      socket.on('disconnected', () => {
        setIsSocketConnected(false);
        setConnectionNotice('Connection lost. Reconnecting to live race server…');
        setIsProcessingAnswer(false);
      }),
      socket.on('connection_error', ({ message }: { message: string }) => {
        setIsSocketConnected(false);
        setConnectionNotice(message);
        setIsProcessingAnswer(false);
      }),
      socket.on(SERVER_EVENTS.LOBBY_STATE, (state: LobbyState) => {
        setLobbyState(state);
        setLeaderboard(state.leaderboard);
        setShowJoinForm(false);
        setIsJoining(false);

        const storedUsername = localStorage.getItem('msp_username');
        const joinedUser = state.players.find(
          (player) => player.username === joinUsernameRef.current.trim() || player.username === storedUsername
        );
        if (joinedUser) {
          localStorage.setItem('msp_user_id', joinedUser.id);
          localStorage.setItem('msp_username', joinedUser.username);
        }
        if (state.currentQuestion) {
          const current = currentQuestionRef.current;
          const currentState = questionStateRef.current;
          const hasRealtimeActiveQuestion = Boolean(
            current
            && currentState
            && ['TRIGGERED', 'LIVE', 'LOCKED', 'ACTIVE'].includes(currentState)
          );

          if (!hasRealtimeActiveQuestion || current?.instanceId === state.currentQuestion.id) {
            hydrateQuestionFromLobby(state);
          }
          return;
        }

        if (state.latestResolution) {
          const activeInstanceId = currentQuestionRef.current?.instanceId ?? null;
          const activeState = questionStateRef.current;
          const hasConflictingActiveQuestion = Boolean(
            activeInstanceId
            && activeInstanceId !== state.latestResolution.instanceId
            && activeState
            && ['TRIGGERED', 'LIVE', 'LOCKED', 'ACTIVE'].includes(activeState)
          );

          if (hasConflictingActiveQuestion) {
            return;
          }

          if (!processedResolutionIds.current.has(state.latestResolution.instanceId)) {
            processedResolutionIds.current.add(state.latestResolution.instanceId);
            setResolution(state.latestResolution);
            setQuestionState('RESOLVED');
          }
        }
      }),
      socket.on(SERVER_EVENTS.QUESTION_EVENT, (event: QuestionEvent) => {
        acknowledgedAnswerIds.current.delete(event.instanceId);
        setCurrentQuestion({
          ...event,
          answerDeadline: event.answerDeadline,
        });
        setQuestionState(event.state);
        setResolution(null);
        setIsProcessingAnswer(false);
        setSuggestedStatKeys(event.suggestedStatKeys ?? []);
        setIsReportFormOpen(false);
        setIsSubmittingReport(false);
        setReportSuccess(false);
        setReportError(null);
        setReportNote('');
        setReportReason('WRONG_ANSWER');

        playSound();
      }),
      socket.on(
        SERVER_EVENTS.QUESTION_STATE,
        (data: QuestionStateEvent) => {
          setQuestionState(data.state);
          if (data.answerDeadline) {
            setCurrentQuestion((current) => {
              if (!current || current.instanceId !== data.instanceId) {
                return current;
              }

              return {
                ...current,
                answerDeadline: data.answerDeadline ?? current.answerDeadline,
              };
            });
          }
          if (data.state !== 'LIVE') {
            setIsProcessingAnswer(false);
          }
          if (['RESOLVED', 'EXPLAINED', 'CLOSED'].includes(data.state)) {
            setCurrentQuestion((current) => (
              current?.instanceId === data.instanceId ? null : current
            ));
            setSuggestedStatKeys([]);
          }
          if (data.state === 'CANCELLED') {
            setCurrentQuestion(null);
            setSuggestedStatKeys([]);
          }
        }
      ),
      socket.on(SERVER_EVENTS.QUESTION_LOCKED, () => {
        setQuestionState('LOCKED');
        setIsProcessingAnswer(false);
      }),
      socket.on(SERVER_EVENTS.QUESTION_CANCELLED, (data: { instanceId: string; reason: string }) => {
        setCurrentQuestion(null);
        setResolution(null);
        setIsProcessingAnswer(false);
        setSuggestedStatKeys([]);
        setError(`Question cancelled: ${data.reason}`);
        setTimeout(() => setError(null), 5000);
      }),
      socket.on(SERVER_EVENTS.QUESTION_TEXT_UPDATE, (data: QuestionTextUpdateEvent) => {
        // Update question text when AI generation completes
        setCurrentQuestion((current) => {
          if (!current || current.instanceId !== data.instanceId) {
            return current;
          }
          return {
            ...current,
            questionText: data.questionText,
            suggestedStatKeys: data.suggestedStatKeys ?? current.suggestedStatKeys ?? [],
          };
        });
        setSuggestedStatKeys(data.suggestedStatKeys ?? []);
      }),
      socket.on(SERVER_EVENTS.RESOLUTION_EVENT, (event: ResolutionEvent) => {
        const activeQuestion = currentQuestionRef.current;
        const activeState = questionStateRef.current;
        const hasUnresolvedQuestion = Boolean(
          activeQuestion
          && activeState
          && ['TRIGGERED', 'LIVE', 'LOCKED', 'ACTIVE'].includes(activeState)
          && activeQuestion.instanceId !== event.instanceId
        );

        if (hasUnresolvedQuestion) {
          return;
        }

        // Deduplicate: skip if already processed this resolution
        if (processedResolutionIds.current.has(event.instanceId)) {
          console.log(`[RESOLUTION] Skipping duplicate for ${event.instanceId}`);
          return;
        }
        processedResolutionIds.current.add(event.instanceId);

        setResolution(event);
        setQuestionState('RESOLVED');
        setCurrentQuestion(null);
        setIsProcessingAnswer(false);
        setSuggestedStatKeys([]);
        setIsReportFormOpen(false);
        setIsSubmittingReport(false);
        setReportSuccess(false);
        setReportError(null);
        setReportNote('');
        setReportReason('WRONG_ANSWER');

        // Check if user submitted an answer and play appropriate sound
        const userAnswer = submittedAnswersRef.current[event.instanceId];
        if (userAnswer) {
          if (userAnswer === event.correctAnswer) {
            setLocalCorrectAnswers((prev) => prev + 1);
            playCorrectSound();
          } else {
            playWrongSound();
          }
        }
      }),
      socket.on(SERVER_EVENTS.LEADERBOARD_UPDATE, (entries: LeaderboardEntry[]) => {
        setLeaderboard(entries);
      }),
      socket.on(SERVER_EVENTS.ANSWER_RECEIVED, (data: { instanceId: string }) => {
        acknowledgedAnswerIds.current.add(data.instanceId);
        setIsProcessingAnswer(false);
      }),
      socket.on(SERVER_EVENTS.RACE_SNAPSHOT_UPDATE, (snapshot: RaceSnapshotEvent) => {
        setRaceSnapshot(snapshot);
      }),
      socket.on(SERVER_EVENTS.FEED_STATUS, ({ stalled }: { stalled: boolean }) => {
        setFeedStalled(stalled);
      }),
      socket.on(SERVER_EVENTS.ERROR, (payload: ServerErrorEvent) => {
        if (payload.code === 'VALIDATION_ERROR' && payload.message.toLowerCase().includes('lobby not found')) {
          setError('Lobby not found');
          return;
        }
        handleSocketError(payload);
      }),
      socket.on(SERVER_EVENTS.PRESENCE_EXPIRED, () => {
        localStorage.removeItem('msp_user_id');
        router.push('/');
      }),
    ];

    const userId = localStorage.getItem('msp_user_id');
    if (userId) {
      socket.reconnectLobby(userId);
    } else {
      socket.lookupLobby(lobbyCode);
    }

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [lobbyCode, playCorrectSound, playSound, playWrongSound, router]);

  useEffect(() => {
    if (!currentUserId) {
      return;
    }

    const socket = getSocketClient();
    socket.sendPresencePing();
    const interval = window.setInterval(() => {
      socket.sendPresencePing();
    }, 90_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [currentUserId]);

  useEffect(() => {
    if (
      raceSnapshot
      && raceCompletedLap === null
      && (
        raceSnapshot.trackStatus === 'CHEQUERED'
        || raceSnapshot.isReplayComplete
        || (raceSnapshot.totalLaps !== null && raceSnapshot.lapNumber >= raceSnapshot.totalLaps)
      )
    ) {
      setRaceCompletedLap(raceSnapshot.totalLaps ?? raceSnapshot.lapNumber);
    }
  }, [raceCompletedLap, raceSnapshot]);

  const handleSubmitAnswer = useCallback(
    (selectedAnswer: 'YES' | 'NO') => {
      if (!currentQuestion || questionState !== 'LIVE' || submittedAnswers[currentQuestion.instanceId] || isProcessingAnswer) return;

      getSocketClient().submitAnswer(currentQuestion.instanceId, selectedAnswer);
      setSubmittedAnswers((current) => ({
        ...current,
        [currentQuestion.instanceId]: selectedAnswer,
      }));
      setIsProcessingAnswer(true);
    },
    [currentQuestion, isProcessingAnswer, questionState, submittedAnswers]
  );

  const handleSubmitReport = useCallback(async () => {
    if (!resolution || !currentUserId || isSubmittingReport) {
      return;
    }

    setIsSubmittingReport(true);
    setReportError(null);

    try {
      const payload: CreateProblemReportInput = {
        instanceId: resolution.instanceId,
        userId: currentUserId,
        reason: reportReason,
        note: reportNote,
      };

      const response = await apiFetch('/reports', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to submit report');
      }

      setReportSuccess(true);
      setIsReportFormOpen(false);
      setReportNote('');
    } catch (submissionError) {
      setReportError((submissionError as Error).message);
    } finally {
      setIsSubmittingReport(false);
    }
  }, [currentUserId, isSubmittingReport, reportNote, reportReason, resolution]);

  const handleLeaveSession = useCallback(async () => {
    setIsLeaving(true);
    try {
      await new Promise<void>((resolve) => {
        getSocketClient().leaveLobby();
        // Give socket time to send event
        setTimeout(resolve, 300);
      });
    } finally {
      localStorage.removeItem('msp_user_id');
      getSocketClient().disconnect();
      router.push('/');
    }
  }, [router]);

  const currentSubmittedAnswer = currentQuestion
    ? submittedAnswers[currentQuestion.instanceId] ?? null
    : null;
  const resolvedAnswer = resolution ? submittedAnswers[resolution.instanceId] ?? null : null;
  const resolvedAnswerIsCorrect = resolvedAnswer !== null && resolvedAnswer === resolution?.correctAnswer;
  const hasRaceCompleted = raceCompletedLap !== null;
  const hasActiveQuestion = Boolean(
    currentQuestion
    && questionState
    && ['TRIGGERED', 'LIVE', 'LOCKED', 'ACTIVE'].includes(questionState)
  );
  const raceHasEnded = Boolean(
    hasRaceCompleted
    || raceSnapshot?.trackStatus === 'CHEQUERED'
    || raceSnapshot?.isReplayComplete
    || lobbyState?.status === 'finished'
  );
  const showWinnerScreen = raceHasEnded && !hasActiveQuestion;
  const tireStatsHighlighted = suggestedStatKeys.some((key) => (
    key === 'TYRE_COMPOUND' || key === 'TYRE_AGE' || key === 'STINT_NUMBER'
  ));
  const showQuestionWaitingState = Boolean(
    currentQuestion && ['TRIGGERED', 'LOCKED', 'ACTIVE'].includes(questionState ?? '')
  );

  const handleJoinSession = useCallback(() => {
    if (!joinUsername.trim()) {
      setError('Please enter a username');
      return;
    }

    setError(null);
    setIsJoining(true);
    localStorage.setItem('msp_username', joinUsername.trim());
    getSocketClient().joinLobby(lobbyCode, joinUsername.trim());
  }, [joinUsername, lobbyCode]);

  if (showJoinForm && !lobbyState) {
    return (
      <main className="app-shell flex items-center justify-center p-4">
        <Card className="w-full max-w-lg" tone="default">
          <SectionLabel index="04" label="Join Live Session" />
          <h1 className="mt-3 font-display text-4xl uppercase tracking-tight">Lobby {lobbyCode}</h1>
          <p className="mt-3 font-body text-sm text-[var(--color-muted-fg)]">
            This session is already underway. Enter your driver name to join from this link.
          </p>
          <label className="mt-6 block">
            <span className="mb-2 block font-display text-xs uppercase tracking-[0.2em] text-[var(--color-muted-fg)]">
              Driver Name
            </span>
            <input
              value={joinUsername}
              onChange={(event) => setJoinUsername(event.target.value)}
              className="h-12 w-full border-2 border-[var(--color-border)] bg-[var(--color-bg)] px-4 font-display text-sm uppercase focus-visible:border-[var(--color-accent)] focus-visible:outline-none"
              placeholder="Your name"
            />
          </label>
          {error && (
            <p className="mt-4 border-2 border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent),transparent_88%)] p-3 font-display text-xs uppercase tracking-[0.14em]">
              {error}
            </p>
          )}
          <Button onClick={handleJoinSession} disabled={isJoining} className="mt-6 w-full">
            {isJoining ? 'Joining Session…' : 'Join Session'}
          </Button>
        </Card>
      </main>
    );
  }

  if (!lobbyState) {
    return (
      <main className="app-shell flex items-center justify-center">
        <p className="font-display text-2xl uppercase tracking-[0.14em]">Connecting to Race…</p>
      </main>
    );
  }

  return (
    <main className="app-shell swiss-noise relative">
      <div className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-8">
        <header className="mb-6 grid gap-4 border-2 border-[var(--color-border)] bg-[var(--color-muted)] p-5 md:grid-cols-[1fr_auto] md:p-6">
          <div>
            <SectionLabel
              index="04"
              label={lobbyState.sessionMode === 'replay' ? 'Replay Session' : 'Live Session'}
            />
            <h1 className="mt-2 font-display text-4xl uppercase leading-none tracking-tight md:text-6xl">
              Lobby {lobbyCode}
            </h1>
            <div className="mt-3 flex flex-wrap gap-2">
              {!isSocketConnected && (
                <span className="border-2 border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1 font-display text-xs uppercase tracking-[0.15em]">
                  Reconnecting…
                </span>
              )}
              {raceSnapshot && (
                <>
                  <span className="border-2 border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1 font-display text-xs uppercase tracking-[0.15em]">
                    {hasRaceCompleted
                      ? `LAP ${raceCompletedLap}: RACE COMPLETED :checkered_flag:`
                      : `Lap ${raceSnapshot.lapNumber}${raceSnapshot.totalLaps ? ` / ${raceSnapshot.totalLaps}` : ''}`}
                  </span>
                  <RaceConditionBadge
                    status={raceSnapshot.trackStatus}
                    highlighted={suggestedStatKeys.includes('TRACK_STATUS')}
                  />
                  <span className="border-2 border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1 font-display text-xs uppercase tracking-[0.15em]">
                    Leader {raceSnapshot.leader}
                  </span>
                  {raceSnapshot.sessionMode === 'replay' && (
                    <span className="border-2 border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1 font-display text-xs uppercase tracking-[0.15em]">
                      Replay {raceSnapshot.replaySpeed}x
                    </span>
                  )}
                  {raceSnapshot.isReplayComplete && (
                    <span className="border-2 border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent),transparent_88%)] px-3 py-1 font-display text-xs uppercase tracking-[0.15em]">
                      Replay Complete
                    </span>
                  )}
                </>
              )}
              {feedStalled && (
                <span className="border-2 border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent),transparent_88%)] px-3 py-1 font-display text-xs uppercase tracking-[0.15em]">
                  Feed Stalled
                </span>
              )}
            </div>
            <p className="mt-3 max-w-3xl font-body text-sm text-[var(--color-muted-fg)]">
              {lobbyState.sessionMode === 'replay'
                ? 'This session is running from OpenF1 historical telemetry at 10x speed. The server watches the replay for question-bank triggers, then Groq/Llama rewrites the prompt and explains each resolution.'
                : 'This session follows live telemetry. Questions appear only when the server-side trigger engine finds a valid race situation.'}
            </p>
            {connectionNotice && (
              <p className="mt-3 border-2 border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-display text-[11px] uppercase tracking-[0.14em]">
                {connectionNotice}
              </p>
            )}

          </div>
          <div className="flex flex-wrap gap-2 md:justify-end">
            <ThemeToggle />
            <Button variant="ghost" onClick={handleLeaveSession} disabled={isLeaving}>
              {isLeaving ? 'Leaving…' : 'Leave Session'}
            </Button>
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-[1fr_360px]">
          <div>
            {/* Priority order: Winner > Resolution > Question LIVE > Question Waiting > Waiting State */}
            {(() => {
              // 1. Winner screen (highest priority)
              if (showWinnerScreen) {
                return (
                  <WinnerScreen
                    key="winner-screen"
                    entries={leaderboard}
                    onBackToLobby={() => router.push(`/lobby/${lobbyCode}`)}
                  />
                );
              }

              // 2. Resolution display
              if (resolution) {
                return (
                  <Card
                    key={`resolution-${resolution.instanceId}`}
                    tone="default"
                    className="p-6 md:p-8"
                  >
                    <SectionLabel index="04A" label="Resolution" className="mb-4" />
                    <h2 className="font-display text-4xl uppercase leading-tight md:text-5xl">{resolution.questionText}</h2>
                    <p className="mt-3 font-display text-sm uppercase tracking-[0.16em] text-[var(--color-muted-fg)]">
                      Correct Answer: <span className="text-[var(--color-accent)]">{resolution.correctAnswer}</span>
                    </p>
                    {resolvedAnswer && (
                      <p
                        className={`mt-2 font-display text-sm uppercase tracking-[0.16em] ${
                          resolvedAnswerIsCorrect ? 'text-[#00C853]' : 'text-[#D50000]'
                        }`}
                      >
                        Your Answer: <span>{resolvedAnswer}</span>
                      </p>
                    )}
                    <div className="mt-5 border-2 border-[var(--color-border)] bg-[var(--color-muted)] p-4">
                      <p className="font-display text-xs uppercase tracking-[0.2em] text-[var(--color-muted-fg)]">Explanation</p>
                      <p className="mt-2 font-body text-sm leading-relaxed">{resolution.explanation}</p>
                    </div>
                    <div className="mt-5 border-2 border-[var(--color-border)] bg-[var(--color-bg)] p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-display text-xs uppercase tracking-[0.2em] text-[var(--color-muted-fg)]">Problem Reporting</p>
                          <p className="mt-2 font-body text-sm text-[var(--color-muted-fg)]">
                            If the AI resolved this question incorrectly, send it to the admin review queue.
                          </p>
                        </div>
                        <Button
                          variant={reportSuccess ? 'secondary' : 'primary'}
                          size="sm"
                          disabled={reportSuccess}
                          onClick={() => setIsReportFormOpen((current) => !current)}
                        >
                          {reportSuccess ? 'Reported' : isReportFormOpen ? 'Close Report' : 'Report a Problem'}
                        </Button>
                      </div>

                      {isReportFormOpen && !reportSuccess && (
                        <div className="mt-4 grid gap-4 border-t-2 border-[var(--color-border)] pt-4">
                          <label className="block">
                            <span className="mb-2 block font-display text-xs uppercase tracking-[0.2em] text-[var(--color-muted-fg)]">
                              Reason
                            </span>
                            <select
                              value={reportReason}
                              onChange={(event) => setReportReason(event.target.value as ProblemReportReason)}
                              className="h-12 w-full border-2 border-[var(--color-border)] bg-[var(--color-bg)] px-4 font-display text-sm uppercase focus-visible:border-[var(--color-accent)] focus-visible:outline-none"
                            >
                              {REPORT_REASON_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="block">
                            <span className="mb-2 block font-display text-xs uppercase tracking-[0.2em] text-[var(--color-muted-fg)]">
                              Optional Note
                            </span>
                            <textarea
                              value={reportNote}
                              onChange={(event) => setReportNote(event.target.value)}
                              rows={4}
                              placeholder="Add the telemetry detail or answer mismatch you think is wrong."
                              className="w-full border-2 border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 font-body text-sm text-[var(--color-fg)] placeholder:text-[var(--color-muted-fg)] focus-visible:border-[var(--color-accent)] focus-visible:outline-none"
                            ></textarea>
                          </label>

                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="font-body text-xs text-[var(--color-muted-fg)]">
                              One report per player per question. Re-submitting updates your previous report.
                            </p>
                            <Button size="sm" onClick={handleSubmitReport} disabled={isSubmittingReport}>
                              {isSubmittingReport ? 'Submitting…' : 'Send Report'}
                            </Button>
                          </div>
                        </div>
                      )}

                      {reportSuccess && (
                        <p className="mt-4 font-display text-xs uppercase tracking-[0.16em] text-[var(--color-accent)]">
                          Report submitted to admin review.
                        </p>
                      )}

                      {reportError && (
                        <p className="mt-4 font-display text-xs uppercase tracking-[0.16em] text-[var(--color-accent)]">
                          {reportError}
                        </p>
                      )}
                    </div>
                  </Card>
                );
              }

              // 3. Question LIVE state
              if (currentQuestion && questionState === 'LIVE') {
                return (
                  <Card
                    key={`question-live-${currentQuestion.instanceId}`}
                    tone="muted"
                    className="swiss-grid-pattern relative p-6 md:p-8"
                  >
                    <div className="mb-6 flex justify-center">
                      <CountdownTimer
                        deadline={
                          currentQuestion.answerDeadline
                            ?? new Date(new Date(currentQuestion.triggeredAt).getTime() + 45_000).toISOString()
                        }
                        totalDurationMs={45_000}
                        size="lg"
                      />
                    </div>
                  <QuestionCard
                      questionText={currentQuestion.questionText}
                      category={currentQuestion.category}
                      difficulty={currentQuestion.difficulty}
                      instanceId={currentQuestion.instanceId}
                      onSubmit={handleSubmitAnswer}
                      disabled={questionState !== 'LIVE'}
                      answered={currentSubmittedAnswer}
                    />

                    {isProcessingAnswer && (
                      <div className="absolute inset-0 flex items-center justify-center bg-[color-mix(in_srgb,var(--color-bg),transparent_12%)] p-6 backdrop-blur-sm">
                        <div className="w-full max-w-md border-2 border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-panel),transparent_6%)] p-6 text-center shadow-[0_0_0_2px_rgba(255,24,1,0.15)]">
                          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border-4 border-[var(--color-border)] border-t-[var(--color-accent)] animate-spin" />
                          <p className="mt-5 font-display text-2xl uppercase tracking-[0.14em]">Pit Wall Processing</p>
                          <p className="mt-3 font-body text-sm text-[var(--color-muted-fg)]">
                            Locking in your call and syncing it with the race control room.
                          </p>
                        </div>
                      </div>
                    )}
                  </Card>
                );
              }

              // 4. Question waiting state (TRIGGERED, LOCKED, ACTIVE)
              if (showQuestionWaitingState && currentQuestion) {
                return (
                  <Card
                    key={`question-waiting-${currentQuestion.instanceId}`}
                    tone="default"
                    className="p-8 text-center"
                  >
                    <p className="font-display text-xs uppercase tracking-[0.2em] text-[var(--color-muted-fg)]">
                      {questionState === 'TRIGGERED'
                        ? 'Question Incoming'
                        : questionState === 'ACTIVE'
                          ? 'Question Active'
                          : 'Answers Locked'}
                    </p>
                    <p className="mt-4 font-display text-4xl uppercase leading-tight">{currentQuestion.questionText}</p>
                    <p className="mt-3 font-body text-sm text-[var(--color-muted-fg)]">
                      {questionState === 'TRIGGERED'
                        ? 'The server has detected a valid race trigger. Answers open as soon as the question goes live.'
                        : questionState === 'ACTIVE'
                          ? 'Outcome is now tied to live race telemetry. Waiting for the next resolution signal.'
                          : 'Awaiting lap completion and resolution.'}
                    </p>
                  </Card>
                );
              }

              // 5. Default waiting state (lowest priority)
              return (
                <Card key="waiting-for-question" tone="default" className="swiss-dots p-10 text-center md:p-16">
                  <p className="font-display text-4xl uppercase md:text-6xl">Waiting for Question</p>
                  <p className="mt-3 font-body text-sm text-[var(--color-muted-fg)]">
                    {lobbyState.isReplayComplete
                      ? 'Replay finished. Final leaderboard is locked in.'
                      : lobbyState.sessionMode === 'replay'
                        ? 'Next trigger arrives from accelerated historical telemetry, not broadcast video.'
                        : 'Next trigger arrives from live race telemetry.'}
                  </p>
                  <p className="mt-4 font-display text-xs uppercase tracking-[0.2em] text-[var(--color-muted-fg)]">
                    Questions asked: {lobbyState.questionCount}/10
                  </p>
                </Card>
              );
            })()}
          </div>

          <aside>
            <TireStats
              leaderStats={raceSnapshot?.leaderStats ?? null}
              highlighted={tireStatsHighlighted}
            />
            {/* Enhance leaderboard with local correct answers for current user */}
            {currentUserId ? (
              <Leaderboard 
                entries={leaderboard.map(entry => 
                  entry.userId === currentUserId 
                    ? {...entry, correctAnswers: localCorrectAnswers} 
                    : entry
                )}
                currentUserId={currentUserId}
              />
            ) : (
              <Leaderboard entries={leaderboard} currentUserId={currentUserId ?? undefined} />
            )}
          </aside>
        </section>
      </div>

      {error && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 border-2 border-[var(--color-accent)] bg-[var(--color-bg)] px-6 py-3 font-display text-xs uppercase tracking-[0.14em] text-[var(--color-fg)]">
          {error}
        </div>
      )}
    </main>
  );
}
