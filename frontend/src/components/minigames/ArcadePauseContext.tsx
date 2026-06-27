'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

interface ArcadePauseContextValue {
  questionSuspended: boolean;
  questionDismissed: boolean;
  questionEffective: boolean;
  questionSuspendMessage: string | null;
  dismissQuestionSuspend: () => void;
  userPaused: boolean;
  setUserPaused: (paused: boolean) => void;
  toggleUserPaused: () => void;
  isPaused: boolean;
}

const ArcadePauseContext = createContext<ArcadePauseContextValue | null>(null);

interface ArcadePauseProviderProps {
  questionSuspended?: boolean;
  questionSuspendMessage?: string | null;
  children: ReactNode;
}

export function ArcadePauseProvider({
  questionSuspended = false,
  questionSuspendMessage = null,
  children,
}: ArcadePauseProviderProps) {
  const [questionDismissed, setQuestionDismissed] = useState(false);
  const [userPaused, setUserPaused] = useState(false);

  useEffect(() => {
    if (questionSuspended) {
      setQuestionDismissed(false);
    }
  }, [questionSuspended, questionSuspendMessage]);

  useEffect(() => {
    if (!questionSuspended) {
      setQuestionDismissed(false);
    }
  }, [questionSuspended]);

  const dismissQuestionSuspend = useCallback(() => {
    setQuestionDismissed(true);
  }, []);

  const toggleUserPaused = useCallback(() => {
    setUserPaused((current) => !current);
  }, []);

  const questionEffective = questionSuspended && !questionDismissed;
  const isPaused = questionEffective || userPaused;

  const value = useMemo(
    () => ({
      questionSuspended,
      questionDismissed,
      questionEffective,
      questionSuspendMessage,
      dismissQuestionSuspend,
      userPaused,
      setUserPaused,
      toggleUserPaused,
      isPaused,
    }),
    [
      questionSuspended,
      questionDismissed,
      questionEffective,
      questionSuspendMessage,
      dismissQuestionSuspend,
      userPaused,
      toggleUserPaused,
      isPaused,
    ]
  );

  return (
    <ArcadePauseContext.Provider value={value}>{children}</ArcadePauseContext.Provider>
  );
}

export function useArcadePause(): ArcadePauseContextValue {
  const context = useContext(ArcadePauseContext);
  if (!context) {
    return {
      questionSuspended: false,
      questionDismissed: false,
      questionEffective: false,
      questionSuspendMessage: null,
      dismissQuestionSuspend: () => {},
      userPaused: false,
      setUserPaused: () => {},
      toggleUserPaused: () => {},
      isPaused: false,
    };
  }
  return context;
}
