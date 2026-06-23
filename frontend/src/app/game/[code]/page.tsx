'use client';

import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import QuestionCard from '@/components/QuestionCard';
import CountdownTimer from '@/components/CountdownTimer';
import Leaderboard from '@/components/Leaderboard';
import RaceHud from '@/components/RaceHud';
import TireStats from '@/components/TireStats';
import WinnerScreen from '@/components/WinnerScreen';
import { getSocketClient } from '@/lib/socket';
import {
  applyPlayerDisconnected,
  applyPlayerJoined,
  applyPlayerLeft,
  applyPlayerReconnected,
} from '@/lib/lobbyPlayerDeltas';
import { cn } from '@/lib/cn';
import { apiFetch } from '@/lib/api';
import { useQuestionSound } from '@/hooks/useQuestionSound';
import { useAnswerOutcomeSounds } from '@/hooks/useAnswerOutcomeSounds';
import { useGameNotifications } from '@/hooks/useGameNotifications';
import { useMemeQueue } from '@/hooks/useMemeQueue';
import NotificationPopUpHint from '@/components/NotificationPopUpHint';
import EmojiReactions from '@/components/EmojiReactions';
import { PitWallArcade } from '@/components/minigames';
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
import { ANSWER_WINDOW_MS, resolveAnswerDeadline } from '@/lib/answerWindow';
import { hasQuestionAlertHandled, markQuestionAlertHandled } from '@/lib/questionAlerts';
import {
  clearInactiveKickRestore,
  clearLobbySession,
  getInactiveKickRestore,
  getStoredLobbySession,
  saveLobbySession,
  stashInactiveKickRestore,
} from '@/lib/sessionPersistence';
import { shareLobbyLink } from '@/lib/shareLobbyLink';
import { Button, Brand, Card, Chip, Input } from '@/components/ui';

const REPORT_REASON_OPTIONS: Array<{ value: ProblemReportReason; label: string }> = [
  { value: 'WRONG_ANSWER', label: 'Wrong Answer' },
  { value: 'BAD_EXPLANATION', label: 'Bad Explanation' },
  { value: 'UNCLEAR_QUESTION', label: 'Unclear Question' },
  { value: 'TELEMETRY_MISMATCH', label: 'Telemetry Mismatch' },
  { value: 'OTHER', label: 'Other' },
];

const UNRESOLVED_QUESTION_STATES: QuestionState[] = ['TRIGGERED', 'LIVE', 'LOCKED', 'ACTIVE'];
const POST_RESOLUTION_QUESTION_STATES: QuestionState[] = ['RESOLVED', 'EXPLAINED', 'CLOSED'];

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
  const [showReconnecting, setShowReconnecting] = useState(false);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);
  const [localCorrectAnswers, setLocalCorrectAnswers] = useState<number>(0);
  const [joinUsername, setJoinUsername] = useState(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('msp_username') ?? '';
  });
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [shareLinkStatus, setShareLinkStatus] = useState<'shared' | 'copied' | null>(null);
  // Set to true when a late joiner arrives and there is already an active LIVE question
  const [lateJoinMidQuestion, setLateJoinMidQuestion] = useState(false);

  const { playSound } = useQuestionSound('/sounds/question-alert.mp3');
  const { playCorrectSound, playWrongSound } = useAnswerOutcomeSounds();
  const { getNextMeme } = useMemeQueue();

  const [activeMeme, setActiveMeme] = useState<{ file: string; folder: string } | null>(null);
  const memeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isMemesMuted, setIsMemesMuted] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('msp_memes_muted') === 'true';
  });

  // Receives the actual userId and sanitized username from the server after joining.
  // Needed because join_lobby/join_solo may sanitize profane names without telling the client.
  const joinedUserIdFromServerRef = useRef<string | null>(null);

  // Track processed resolutions to prevent flickering from duplicate events
  const processedResolutionIds = useRef<Set<string>>(new Set());
  const acknowledgedAnswerIds = useRef<Set<string>>(new Set());
  const currentQuestionRef = useRef<QuestionEvent | null>(null);
  const questionStateRef = useRef<QuestionState | null>(null);
  const resolutionRef = useRef<ResolutionEvent | null>(null);
  const submittedAnswersRef = useRef<Record<string, 'YES' | 'NO'>>({});
  const joinUsernameRef = useRef(joinUsername);

  const currentUserId = typeof window !== 'undefined' ? localStorage.getItem('msp_user_id') : null;

  const beginLobbyEntry = useCallback((socket: ReturnType<typeof getSocketClient>) => {
    const storedSession = getStoredLobbySession();
    const normalizedCode = lobbyCode.toUpperCase();

    if (storedSession && storedSession.lobbyCode.toUpperCase() === normalizedCode) {
      // Bypass the SocketClient-level dedupe so React Strict Mode's double-invoke
      // (and any other legitimate remount) always re-sends reconnect_lobby.
      // SessionResume keeps its own 1.5 s + 2 s guards to prevent rapid-fire duplicates.
      socket.reconnectLobby(storedSession.userId, { dedupeWindowMs: 0 });
      return;
    }

    if (storedSession) {
      clearLobbySession();
    }

    socket.lookupLobby(lobbyCode);
  }, [lobbyCode]);
  useEffect(() => {
    currentQuestionRef.current = currentQuestion;
  }, [currentQuestion]);

  useEffect(() => {
    questionStateRef.current = questionState;
  }, [questionState]);

  useEffect(() => {
    resolutionRef.current = resolution;
  }, [resolution]);

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

      // Use server's answerDeadline if available, fallback to trigger math when LIVE
      const answerDeadline = resolveAnswerDeadline(
        question.answerDeadline
          ? (typeof question.answerDeadline === 'string'
              ? question.answerDeadline
              : new Date(question.answerDeadline).toISOString())
          : undefined,
        triggeredAt,
        question.state
      ) ?? undefined;

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
    markQuestionAlertHandled(question.id);
    // Only clear the resolution panel when hydrating a still-active question.
    if (UNRESOLVED_QUESTION_STATES.includes(question.state)) {
      setResolution(null);
    }
    if (question.state !== 'LIVE') {
      setIsProcessingAnswer(false);
    }
  });

  const restoreResolutionFromLobby = useEffectEvent((latestResolution: ResolutionEvent) => {
    processedResolutionIds.current.add(latestResolution.instanceId);
    setCurrentQuestion(null);
    setSuggestedStatKeys([]);
    setIsProcessingAnswer(false);
    setResolution(latestResolution);
    setQuestionState('RESOLVED');
  });

  const handleSocketError = useEffectEvent(({ message, code }: ServerErrorEvent) => {
    const normalizedMessage = message.toLowerCase();
    const isSessionExpired = code === 'SESSION_EXPIRED'
      || normalizedMessage.includes('user not in any lobby')
      || normalizedMessage.includes('user not found')
      || normalizedMessage.includes('session expired');

    if (isSessionExpired) {
      const kickedUserId = localStorage.getItem('msp_user_id');
      if (kickedUserId) {
        stashInactiveKickRestore(kickedUserId, lobbyCode);
      }
      clearLobbySession();
      setLobbyState(null);
      setShowJoinForm(true);
      setConnectionNotice('You were away for a while. Re-enter your driver name to restore your score.');
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
    const refreshPresence = () => {
      if (document.visibilityState === 'hidden') {
        getSocketClient().sendPresencePing();
        return;
      }

      const storedUserId = localStorage.getItem('msp_user_id');
      const storedLobbyCode = localStorage.getItem('msp_lobby_code');
      if (!storedUserId || storedLobbyCode?.toUpperCase() !== lobbyCode.toUpperCase()) {
        return;
      }

      const socket = getSocketClient();
      if (!socket.isConnected()) {
        setConnectionNotice('Reconnecting to live race server…');
      }
      socket.resumeAfterBackground();
    };

    document.addEventListener('visibilitychange', refreshPresence);
    window.addEventListener('focus', refreshPresence);

    return () => {
      document.removeEventListener('visibilitychange', refreshPresence);
      window.removeEventListener('focus', refreshPresence);
    };
  }, [lobbyCode]);

  useEffect(() => {
    if (isSocketConnected) {
      setShowReconnecting(false);
      return undefined;
    }

    if (document.visibilityState === 'hidden') {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      if (document.visibilityState === 'visible' && !getSocketClient().isConnected()) {
        setShowReconnecting(true);
      }
    }, 1500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isSocketConnected]);

  useEffect(() => {
    const socket = getSocketClient();
    socket.connect();

    const unsubscribers = [
      socket.on('connected', () => {
        setIsSocketConnected(true);
        setConnectionNotice(null);
        beginLobbyEntry(socket);
      }),
      socket.on(SERVER_EVENTS.LOBBY_LOOKUP, () => {
        const storedSession = getStoredLobbySession();
        if (storedSession?.lobbyCode.toUpperCase() === lobbyCode.toUpperCase()) {
          return;
        }

        clearLobbySession();
        setShowJoinForm(true);
      }),
      socket.on('disconnected', ({ hidden }: { reason?: string; hidden?: boolean }) => {
        setIsSocketConnected(false);
        if (!hidden && document.visibilityState === 'visible') {
          setConnectionNotice('Connection lost. Reconnecting to live race server…');
        }
        setIsProcessingAnswer(false);
      }),
      socket.on('connection_error', ({ message }: { message: string }) => {
        setIsSocketConnected(false);
        setConnectionNotice(message);
        setIsProcessingAnswer(false);
      }),
      socket.on(SERVER_EVENTS.JOIN_RESULT, (data: { userId: string; username: string }) => {
        // Server confirmed the actual userId and (possibly sanitized) username after a join.
        joinedUserIdFromServerRef.current = data.userId;
        saveLobbySession({ userId: data.userId, username: data.username });
      }),
      socket.on(SERVER_EVENTS.LOBBY_STATE, (state: LobbyState) => {
        setLobbyState(state);
        setLeaderboard(state.leaderboard);
        setShowJoinForm(false);
        setIsJoining(false);

        const storedUsername = localStorage.getItem('msp_username');
        // Prefer matching by userId from join_result so sanitized usernames always resolve correctly.
        const joinedUser = joinedUserIdFromServerRef.current
          ? state.players.find((player) => player.id === joinedUserIdFromServerRef.current)
          : state.players.find(
              (player) => player.username === joinUsernameRef.current.trim() || player.username === storedUsername
            );

        joinedUserIdFromServerRef.current = null;

        if (joinedUser) {
          localStorage.setItem('msp_username', joinedUser.username);
          saveLobbySession({
            userId: joinedUser.id,
            username: joinedUser.username,
            lobbyCode: state.code,
            lobbyStatus: state.status === 'waiting' ? 'waiting' : 'active',
          });
          clearInactiveKickRestore();
        }

        // Detect late-join during an active LIVE question — show waiting state instead of
        // the question card so the player doesn't get only a few seconds to answer.
        const myId = joinedUser?.id ?? localStorage.getItem('msp_user_id');
        const me = state.players.find((p) => p.id === myId);
        if (
          me?.joinedAtLap &&
          me.joinedAtLap > 1 &&
          state.currentQuestion &&
          state.currentQuestion.state === 'LIVE'
        ) {
          setLateJoinMidQuestion(true);
        }
        if (state.currentQuestion) {
          const serverQuestion = state.currentQuestion;

          // Server keeps currentQuestion through EXPLAINED (~10s). Reconnecting on
          // tab focus must not hydrate that as an active question — it clears the
          // resolution panel the user already received in the background.
          if (POST_RESOLUTION_QUESTION_STATES.includes(serverQuestion.state)) {
            if (state.latestResolution) {
              restoreResolutionFromLobby(state.latestResolution);
            } else {
              setCurrentQuestion(null);
              setSuggestedStatKeys([]);
              setIsProcessingAnswer(false);
            }
            return;
          }

          const current = currentQuestionRef.current;
          const currentState = questionStateRef.current;
          // Only skip hydration when local state has a DIFFERENT, still-active
          // question — meaning real-time events are already ahead of this snapshot.
          // If the instanceIds match, or local has no active question, always
          // hydrate so a reconnect never leaves the client stuck on stale state.
          const hasConflictingLocalQuestion = Boolean(
            current
            && currentState
            && UNRESOLVED_QUESTION_STATES.includes(currentState)
            && current.instanceId !== serverQuestion.id
          );

          if (!hasConflictingLocalQuestion) {
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
            && UNRESOLVED_QUESTION_STATES.includes(activeState)
          );

          if (hasConflictingActiveQuestion) {
            return;
          }

          const alreadyShowingThisResolution = resolutionRef.current?.instanceId
            === state.latestResolution.instanceId;
          if (!alreadyShowingThisResolution) {
            restoreResolutionFromLobby(state.latestResolution);
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
        // New question arrived — this one they see from the start, clear late-join gate
        setLateJoinMidQuestion(false);

        // Guard against playing the sound twice: reconnect catch-up re-sends
        // question_event for the already-active question, but the user already
        // heard it the first time (or saw it hydrated from lobby_state).
        if (hasQuestionAlertHandled(event.instanceId)) {
          return;
        }

        const isForeground = document.visibilityState === 'visible' && document.hasFocus();
        if (isForeground) {
          markQuestionAlertHandled(event.instanceId);
          playSound();
        }
      }),
      socket.on(
        SERVER_EVENTS.QUESTION_STATE,
        (data: QuestionStateEvent) => {
          setQuestionState(data.state);
          setCurrentQuestion((current) => {
            if (!current || current.instanceId !== data.instanceId) {
              return current;
            }

            return {
              ...current,
              state: data.state,
              answerDeadline: data.answerDeadline ?? current.answerDeadline,
            };
          });
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
          && UNRESOLVED_QUESTION_STATES.includes(activeState)
          && activeQuestion.instanceId !== event.instanceId
        );

        if (hasUnresolvedQuestion) {
          return;
        }

        const alreadyShowingThisResolution = resolutionRef.current?.instanceId === event.instanceId;
        const isDuplicateEvent = processedResolutionIds.current.has(event.instanceId);

        // Deduplicate replays, but re-apply if the UI lost resolution (tab-focus reconnect).
        if (isDuplicateEvent && alreadyShowingThisResolution) {
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

        // Check if user submitted an answer and play appropriate sound (first delivery only)
        if (!isDuplicateEvent) {
          const userAnswer = submittedAnswersRef.current[event.instanceId];
          if (userAnswer) {
            if (userAnswer === event.correctAnswer) {
              setLocalCorrectAnswers((prev) => prev + 1);
              playCorrectSound();
            } else {
              playWrongSound();
            }
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
      socket.on(SERVER_EVENTS.PLAYER_JOINED, (data: { userId: string; username: string; joinedAtLap?: number }) => {
        setLobbyState((prev) => (prev ? applyPlayerJoined(prev, data) : prev));
      }),
      socket.on(SERVER_EVENTS.PLAYER_LEFT, (data: { userId: string }) => {
        setLobbyState((prev) => (prev ? applyPlayerLeft(prev, data) : prev));
        setLeaderboard((prev) => prev.filter((entry) => entry.userId !== data.userId));
      }),
      socket.on(SERVER_EVENTS.PLAYER_DISCONNECTED, (data: { userId: string }) => {
        setLobbyState((prev) => (prev ? applyPlayerDisconnected(prev, data) : prev));
      }),
      socket.on(SERVER_EVENTS.PLAYER_RECONNECTED, (data: { userId: string }) => {
        setLobbyState((prev) => (prev ? applyPlayerReconnected(prev, data) : prev));
      }),
      socket.on(SERVER_EVENTS.ERROR, (payload: ServerErrorEvent) => {
        if (payload.code === 'VALIDATION_ERROR' && payload.message.toLowerCase().includes('lobby not found')) {
          setError('Lobby not found');
          return;
        }
        handleSocketError(payload);
      }),
      socket.on(SERVER_EVENTS.PRESENCE_EXPIRED, () => {
        const kickedUserId = localStorage.getItem('msp_user_id');
        if (kickedUserId) {
          stashInactiveKickRestore(kickedUserId, lobbyCode);
        }
        clearLobbySession();
        setLobbyState(null);
        setShowJoinForm(true);
        setConnectionNotice('You were away for a while. Re-enter your driver name to restore your score.');
      }),
    ];

    if (socket.isConnected()) {
      beginLobbyEntry(socket);
    }

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [beginLobbyEntry, lobbyCode, playCorrectSound, playSound, playWrongSound, router]);

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

  const handleShareLobby = useCallback(async () => {
    const shareUrl = lobbyState?.shareUrl ?? `${window.location.origin}/lobby/${lobbyCode}`;
    try {
      const result = await shareLobbyLink({ url: shareUrl, code: lobbyCode });
      if (result === 'cancelled') return;
      setShareLinkStatus(result);
      setTimeout(() => setShareLinkStatus(null), 2500);
    } catch {
      setError('Could not share. Try copying the code manually.');
    }
  }, [lobbyCode, lobbyState?.shareUrl]);

  const handleLeaveSession = useCallback(async () => {
    setIsLeaving(true);
    try {
      const userId = localStorage.getItem('msp_user_id');
      if (userId && lobbyCode) {
        stashInactiveKickRestore(userId, lobbyCode);
      }
      await new Promise<void>((resolve) => {
        getSocketClient().leaveLobby();
        // Give socket time to send event
        setTimeout(resolve, 300);
      });
    } finally {
      clearLobbySession();
      getSocketClient().disconnect();
      router.push('/');
    }
  }, [router, lobbyCode]);

  const currentSubmittedAnswer = currentQuestion
    ? submittedAnswers[currentQuestion.instanceId] ?? null
    : null;
  const resolvedAnswer = resolution ? submittedAnswers[resolution.instanceId] ?? null : null;
  const resolvedAnswerIsCorrect = resolvedAnswer !== null && resolvedAnswer === resolution?.correctAnswer;
  const hasRaceCompleted = raceCompletedLap !== null;
  const hasActiveQuestion = Boolean(
    currentQuestion
    && questionState
    && UNRESOLVED_QUESTION_STATES.includes(questionState)
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

  const notificationsEnabled = Boolean(
    lobbyState
    && !showJoinForm
    && lobbyState.status === 'active'
    && currentUserId
  );

  const {
    showPrompt: showNotificationPrompt,
    showPopUpHint: showNotificationPopUpHint,
    enableNotifications,
    dismissPrompt: dismissNotificationPrompt,
  } = useGameNotifications({
    lobbyCode,
    enabled: notificationsEnabled,
    playerId: currentUserId ?? undefined,
    playQuestionSound: playSound,
  });

  const handleJoinSession = useCallback(() => {
    if (!joinUsername.trim()) {
      setError('Please enter a username');
      return;
    }

    setError(null);
    setIsJoining(true);
    localStorage.setItem('msp_username', joinUsername.trim());
    getSocketClient().joinLobby(lobbyCode, joinUsername.trim(), {
      restoreUserId: getInactiveKickRestore(lobbyCode),
    });
  }, [joinUsername, lobbyCode]);

  // Delayed meme: show 3s after resolution so users can read the answer first
  useEffect(() => {
    if (memeTimerRef.current) clearTimeout(memeTimerRef.current);
    if (!resolution) {
      setActiveMeme(null);
      return;
    }
    const userAnswer = submittedAnswersRef.current[resolution.instanceId] ?? null;
    const isCorrect = userAnswer !== null && userAnswer === resolution.correctAnswer;
    memeTimerRef.current = setTimeout(() => {
      const file = getNextMeme(isCorrect);
      if (file) {
        const folder = isCorrect ? 'CorrectAnswerMemes' : 'WrongAnswerMemes';
        setActiveMeme({ file, folder });
      }
    }, 3000);
    return () => {
      if (memeTimerRef.current) clearTimeout(memeTimerRef.current);
    };
  }, [resolution, getNextMeme]);

  if (showJoinForm) {
    return (
      <main className="app-bg pad-safe-top pad-safe-bottom flex min-h-dvh items-center justify-center p-5">
        <Card tone="elevated" className="w-full max-w-md animate-fade-up rounded-[var(--radius-lg)]">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-accent)]">Rejoin the race</p>
          <h1 className="mt-2 font-display text-5xl font-bold uppercase tracking-tight">{lobbyCode}</h1>
          <p className="mt-3 text-sm text-[var(--color-muted-fg)]">
            {connectionNotice ?? 'This race is already underway. Enter your driver name to jump back in.'}
          </p>
          <Input
            id="game-join-name"
            label="Driver name"
            value={joinUsername}
            onChange={(event) => setJoinUsername(event.target.value)}
            placeholder="Your name"
            className="mt-5"
          />
          {error && (
            <p className="mt-4 rounded-[var(--radius-sm)] border border-[var(--color-accent)]/50 bg-[var(--color-accent-soft)] px-4 py-3 text-sm font-medium text-[var(--color-accent)]">
              {error}
            </p>
          )}
          <Button onClick={handleJoinSession} disabled={isJoining} size="lg" className="mt-6 w-full">
            {isJoining ? 'Joining…' : 'Join race'}
          </Button>
        </Card>
      </main>
    );
  }

  if (!lobbyState) {
    return (
      <main className="app-bg flex min-h-dvh flex-col items-center justify-center gap-4">
        <span className="h-10 w-10 animate-spin-slow rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)]" />
        <p className="font-display text-lg uppercase tracking-wide text-[var(--color-muted-fg)]">Connecting to race…</p>
      </main>
    );
  }

  const myScore = resolution?.scores?.find((score) => score.userId === currentUserId) ?? null;

  const leaderboardForDisplay = currentUserId
    ? leaderboard.map((entry) =>
        entry.userId === currentUserId ? { ...entry, correctAnswers: localCorrectAnswers } : entry
      )
    : leaderboard;

  // Reassurance line shown inside the always-on arcade — adapts to what's happening above it.
  const arcadeContextLabel = resolution
    ? "Result's in above — the next question will alert you the instant it drops."
    : currentQuestion && questionState === 'LIVE'
      ? currentSubmittedAnswer
        ? 'Answer locked in — play on while the race settles it.'
        : "There's a live question above — lock in your answer, then keep playing."
      : currentQuestion && (questionState === 'ACTIVE' || questionState === 'LOCKED')
        ? "Your answer is in — we'll reveal the result the moment the lap settles."
        : currentQuestion && questionState === 'TRIGGERED'
          ? 'Question incoming above — get ready, then jump back in.'
          : `No question right now · ${lobbyState.questionCount} asked so far — we'll alert you the instant one drops.`;

  return (
    <main className="app-bg relative min-h-dvh">
      {/* Sticky HUD */}
      <div
        className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-bg-2)]/85 backdrop-blur"
        style={{ paddingTop: 'var(--safe-top)' }}
      >
        <div className="mx-auto w-full max-w-5xl px-4">
          <div className="flex items-center justify-between gap-3 py-2.5">
            <div className="flex items-center gap-2">
              <Brand variant="mark" className="h-8 w-8" />
              <Chip tone="warn" className="px-2 py-0.5 text-[0.65rem]">
                Beta
              </Chip>
              {lobbyState.isSimulation && <Chip tone="info">Sim</Chip>}
              <button
                type="button"
                onClick={handleShareLobby}
                aria-label={`Share lobby link for ${lobbyCode}`}
                className="group inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--color-border)]/70 px-2.5 transition-colors hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-muted)]/40 active:scale-[0.98]"
              >
                {shareLinkStatus === 'shared' ? (
                  <span className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-go)]">
                    Shared
                  </span>
                ) : shareLinkStatus === 'copied' ? (
                  <span className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-go)]">
                    Copied
                  </span>
                ) : (
                  <>
                    <span className="text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-[var(--color-faint-fg)] transition-colors group-hover:text-[var(--color-muted-fg)]">
                      Share
                    </span>
                    <span className="h-2.5 w-px bg-[var(--color-border)]" aria-hidden />
                    <span className="font-mono text-[0.7rem] font-bold tracking-[0.18em] text-[var(--color-muted-fg)] transition-colors group-hover:text-[var(--color-fg)]">
                      {lobbyCode}
                    </span>
                  </>
                )}
              </button>
            </div>
            <Button variant="ghost" size="sm" onClick={handleLeaveSession} disabled={isLeaving}>
              {isLeaving ? 'Leaving…' : 'Leave'}
            </Button>
          </div>
          <div className="pb-2.5">
            <RaceHud
              snapshot={raceSnapshot}
              raceCompletedLap={raceCompletedLap}
              feedStalled={feedStalled}
              connected={isSocketConnected && !showReconnecting}
              highlightTrackStatus={suggestedStatKeys.includes('TRACK_STATUS')}
            />
          </div>
        </div>
      </div>

      {connectionNotice && (
        <div className="mx-auto w-full max-w-5xl px-4 pt-3">
          <p className="rounded-[var(--radius-sm)] bg-[var(--color-muted)] px-4 py-2.5 text-sm text-[var(--color-muted-fg)]">
            {connectionNotice}
          </p>
        </div>
      )}

      {showNotificationPrompt && (
        <div className="mx-auto w-full max-w-5xl px-4 pt-3">
          <div className="flex flex-col gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[var(--color-fg)]">
              Get alerted when you switch apps — we&apos;ll notify you when a new question appears.
            </p>
            <div className="flex shrink-0 gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={dismissNotificationPrompt}>
                Not now
              </Button>
              <Button type="button" size="sm" onClick={() => void enableNotifications()}>
                Enable alerts
              </Button>
            </div>
          </div>
        </div>
      )}

      {showNotificationPopUpHint && (
        <div className="mx-auto w-full max-w-5xl px-4 pt-3">
          <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <p className="text-sm font-semibold text-[var(--color-fg)]">Alerts enabled</p>
            <NotificationPopUpHint visible />
          </div>
        </div>
      )}

      <div className="mx-auto grid w-full max-w-5xl gap-5 px-4 py-5 lg:grid-cols-[1fr_minmax(300px,360px)]">
        {/* Main stage */}
        <div className="min-w-0">
          {(() => {
            // 1. Winner screen
            if (showWinnerScreen) {
              return (
                <WinnerScreen
                  key="winner-screen"
                  entries={leaderboard}
                  currentUserId={currentUserId ?? undefined}
                  onLeaveLobby={handleLeaveSession}
                  isLeaving={isLeaving}
                />
              );
            }

            // 2. Resolution
            if (resolution) {
              return (
                <Card
                  key={`resolution-${resolution.instanceId}`}
                  tone="elevated"
                  className="animate-pop-in"
                >
                  <div
                    className={cn(
                      'flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-bold uppercase tracking-wide',
                      resolvedAnswer === null
                        ? 'bg-[var(--color-muted)] text-[var(--color-muted-fg)]'
                        : resolvedAnswerIsCorrect
                          ? 'bg-[var(--color-go-soft)] text-[var(--color-go)]'
                          : 'bg-[rgba(255,59,59,0.14)] text-[var(--color-danger)]'
                    )}
                  >
                    {resolvedAnswer === null
                      ? '⏱ No answer locked in'
                      : resolvedAnswerIsCorrect
                        ? '✓ Nailed it'
                        : '✕ Not this time'}
                    {myScore && myScore.pointsChange > 0 && (
                      <span className="ml-auto">+{myScore.pointsChange} pts</span>
                    )}
                  </div>

                  <h2 className="mt-4 font-display text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
                    {resolution.questionText}
                  </h2>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Chip tone="go">Correct: {resolution.correctAnswer}</Chip>
                    {resolvedAnswer && (
                      <Chip tone={resolvedAnswerIsCorrect ? 'go' : 'danger'}>You: {resolvedAnswer}</Chip>
                    )}
                  </div>

                  <div className="mt-5 rounded-[var(--radius-sm)] bg-[var(--color-muted)] p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-faint-fg)]">
                      Why
                    </p>
                    <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-fg)]">
                      {resolution.explanation}
                    </p>
                  </div>

                  {activeMeme && (
                    <div className="mt-5 animate-fade-in overflow-hidden rounded-[var(--radius-sm)]">
                      {/\.(mp4|webm|mov)$/i.test(activeMeme.file) ? (
                        <div className="relative">
                          <video
                            key={activeMeme.file}
                            ref={(el) => { if (el) el.muted = isMemesMuted; }}
                            src={`/${activeMeme.folder}/${encodeURIComponent(activeMeme.file)}`}
                            autoPlay
                            playsInline
                            className="w-full rounded-[var(--radius-sm)]"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const next = !isMemesMuted;
                              setIsMemesMuted(next);
                              localStorage.setItem('msp_memes_muted', String(next));
                            }}
                            className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-opacity hover:bg-black/70"
                            aria-label={isMemesMuted ? 'Unmute' : 'Mute'}
                          >
                            {isMemesMuted ? (
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                                <path d="M9.547 3.062A.75.75 0 0 1 10 3.75v12.5a.75.75 0 0 1-1.264.546L4.703 13H3.167a.75.75 0 0 1-.7-.48A6.985 6.985 0 0 1 2 10c0-.887.165-1.737.468-2.52a.75.75 0 0 1 .699-.48h1.535l4.033-3.296a.75.75 0 0 1 .812-.142ZM13.78 7.22a.75.75 0 1 0-1.06 1.06L14.44 10l-1.72 1.72a.75.75 0 0 0 1.06 1.06L15.5 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L16.56 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L15.5 8.94l-1.72-1.72Z" />
                              </svg>
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                                <path d="M9.547 3.062A.75.75 0 0 1 10 3.75v12.5a.75.75 0 0 1-1.264.546L4.703 13H3.167a.75.75 0 0 1-.7-.48A6.985 6.985 0 0 1 2 10c0-.887.165-1.737.468-2.52a.75.75 0 0 1 .699-.48h1.535l4.033-3.296a.75.75 0 0 1 .812-.142ZM12.97 7.22a.75.75 0 0 1 1.06 0 5.5 5.5 0 0 1 0 5.56.75.75 0 0 1-1.06-1.06 4 4 0 0 0 0-3.44.75.75 0 0 1 0-1.06Z" />
                              </svg>
                            )}
                          </button>
                        </div>
                      ) : (
                        <img
                          key={activeMeme.file}
                          src={`/${activeMeme.folder}/${encodeURIComponent(activeMeme.file)}`}
                          alt=""
                          className="w-full rounded-[var(--radius-sm)]"
                        />
                      )}
                    </div>
                  )}

                  {/* Report — tucked away */}
                  <div className="mt-4">
                    {!reportSuccess ? (
                      <button
                        type="button"
                        onClick={() => setIsReportFormOpen((current) => !current)}
                        className="text-sm font-medium text-[var(--color-faint-fg)] underline-offset-2 transition-colors hover:text-[var(--color-fg)] hover:underline"
                      >
                        {isReportFormOpen ? 'Cancel report' : 'Something look wrong? Report it'}
                      </button>
                    ) : (
                      <p className="text-sm font-medium text-[var(--color-go)]">Thanks — sent to review.</p>
                    )}

                    {isReportFormOpen && !reportSuccess && (
                      <div className="mt-3 grid gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] p-4">
                        <label className="block">
                          <span className="mb-1.5 block text-sm font-medium text-[var(--color-muted-fg)]">Reason</span>
                          <select
                            value={reportReason}
                            onChange={(event) => setReportReason(event.target.value as ProblemReportReason)}
                            className="h-12 w-full rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg-2)] px-4 text-sm focus-visible:border-[var(--color-accent)] focus-visible:outline-none"
                          >
                            {REPORT_REASON_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <textarea
                          value={reportNote}
                          onChange={(event) => setReportNote(event.target.value)}
                          rows={3}
                          placeholder="Optional: what looked off?"
                          className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg-2)] px-4 py-3 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-faint-fg)] focus-visible:border-[var(--color-accent)] focus-visible:outline-none"
                        />
                        <Button size="sm" onClick={handleSubmitReport} disabled={isSubmittingReport} className="justify-self-start">
                          {isSubmittingReport ? 'Sending…' : 'Send report'}
                        </Button>
                        {reportError && (
                          <p className="text-sm font-medium text-[var(--color-accent)]">{reportError}</p>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              );
            }

            // 3a. Late joiner arrived while a LIVE question was already running
            if (lateJoinMidQuestion && currentQuestion && questionState === 'LIVE') {
              return (
                <Card key="late-join-waiting" tone="elevated" className="py-14 text-center md:py-20 animate-pop-in">
                  <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-muted)]">
                    <span className="h-6 w-6 animate-spin-slow rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)]" />
                  </span>
                  <p className="font-display text-3xl font-bold uppercase md:text-4xl">
                    Waiting for next question
                  </p>
                  <p className="mx-auto mt-3 max-w-sm text-sm text-[var(--color-muted-fg)]">
                    A question is already in progress. You&apos;ll be able to answer from the very
                    next one — hang tight.
                  </p>
                </Card>
              );
            }

            // 3. Live question
            if (currentQuestion && questionState === 'LIVE') {
              const answerDeadline = resolveAnswerDeadline(
                currentQuestion.answerDeadline,
                currentQuestion.triggeredAt,
                questionState
              );

              return (
                <Card
                  key={`question-live-${currentQuestion.instanceId}`}
                  tone="elevated"
                  className="relative animate-pop-in"
                >
                  {answerDeadline && (
                    <div className="mb-5 flex justify-center">
                      <CountdownTimer
                        deadline={answerDeadline}
                        totalDurationMs={ANSWER_WINDOW_MS}
                        size="lg"
                      />
                    </div>
                  )}
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
                    <div className="absolute inset-0 flex items-center justify-center rounded-[var(--radius)] bg-[var(--color-bg)]/80 p-6 backdrop-blur-sm">
                      <div className="text-center">
                        <span className="mx-auto block h-12 w-12 animate-spin-slow rounded-full border-[3px] border-[var(--color-border)] border-t-[var(--color-accent)]" />
                        <p className="mt-4 font-display text-xl font-semibold uppercase tracking-wide">Locking in…</p>
                      </div>
                    </div>
                  )}
                </Card>
              );
            }

            // 4. Question waiting (TRIGGERED, LOCKED, ACTIVE)
            if (showQuestionWaitingState && currentQuestion) {
              return (
                <Card key={`question-waiting-${currentQuestion.instanceId}`} tone="elevated" className="text-center">
                  <Chip tone="accent" className="mx-auto animate-flash">
                    {questionState === 'TRIGGERED'
                      ? 'Question incoming'
                      : questionState === 'ACTIVE'
                        ? 'In play'
                        : 'Answers locked'}
                  </Chip>
                  <p className="mt-5 font-display text-2xl font-semibold leading-tight md:text-3xl">
                    {currentQuestion.questionText}
                  </p>
                  <p className="mt-3 text-sm text-[var(--color-muted-fg)]">
                    {questionState === 'TRIGGERED'
                      ? 'Get ready — answers open in a moment.'
                      : questionState === 'ACTIVE'
                        ? 'Watching the race to settle this one.'
                        : 'Waiting for the lap to resolve.'}
                  </p>
                </Card>
              );
            }

            // 5. Idle waiting
            return (
              <Card key="waiting-for-question" tone="elevated" className="py-14 text-center md:py-20">
                <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-muted)]">
                  <span className="h-6 w-6 animate-spin-slow rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)]" />
                </span>
                <p className="font-display text-3xl font-bold uppercase md:text-4xl">Waiting for the next call</p>
                <p className="mx-auto mt-3 max-w-sm text-sm text-[var(--color-muted-fg)]">
                  {lobbyState.isReplayComplete
                    ? 'Replay finished — final standings are locked in.'
                    : 'Questions appear as the race throws up the right moments. Stay sharp.'}
                </p>
                <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-[var(--color-faint-fg)]">
                  Questions asked: {lobbyState.questionCount}
                </p>
              </Card>
            );
          })()}

          {/* Persistent Pit Wall Arcade — always mounted so an in-progress game (and any
              high-score run) is never interrupted when a question or result appears above it.
              Hidden only once the race is over and the winner screen takes over. */}
          {!showWinnerScreen && !lobbyState.isReplayComplete && (
            <div className="mt-5">
              <PitWallArcade contextLabel={arcadeContextLabel} />
            </div>
          )}

          {/* Race leader / tyre stats below the stage */}
          <div className="mt-5 lg:hidden">
            <TireStats
              leaderStats={raceSnapshot?.leaderStats ?? null}
              lapNumber={raceSnapshot?.lapNumber ?? null}
              highlighted={tireStatsHighlighted}
            />
          </div>

          {/* Leaderboard on mobile */}
          <div className="mt-5 lg:hidden">
            <Leaderboard entries={leaderboardForDisplay} currentUserId={currentUserId ?? undefined} players={lobbyState.players} />
          </div>
        </div>

        {/* Desktop sidebar */}
        <aside className="hidden flex-col gap-5 lg:flex">
          <TireStats
            leaderStats={raceSnapshot?.leaderStats ?? null}
            lapNumber={raceSnapshot?.lapNumber ?? null}
            highlighted={tireStatsHighlighted}
          />
          <div className="sticky top-[150px]">
            <Leaderboard entries={leaderboardForDisplay} currentUserId={currentUserId ?? undefined} players={lobbyState.players} />
          </div>
        </aside>
      </div>

      {error && (
        <div className="pad-safe-bottom fixed inset-x-0 bottom-0 z-40 flex justify-center px-4">
          <p className="animate-fade-up mb-4 rounded-[var(--radius-pill)] border border-[var(--color-accent)]/50 bg-[var(--color-bg-2)] px-5 py-3 text-sm font-medium text-[var(--color-fg)] shadow-[var(--shadow-lg)]">
            {error}
          </p>
        </div>
      )}

      <EmojiReactions />
    </main>
  );
}
