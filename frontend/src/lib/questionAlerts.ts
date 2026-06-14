const HANDLED_QUESTIONS_KEY = 'msp_question_alerts_handled';

function readHandledIds(): string[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    return JSON.parse(sessionStorage.getItem(HANDLED_QUESTIONS_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function writeHandledIds(ids: string[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    sessionStorage.setItem(HANDLED_QUESTIONS_KEY, JSON.stringify(ids.slice(-30)));
  } catch {
    // Ignore storage failures.
  }
}

export function markQuestionAlertHandled(instanceId: string): void {
  const stored = readHandledIds();
  if (stored.includes(instanceId)) {
    return;
  }

  writeHandledIds([...stored, instanceId]);
}

export function hasQuestionAlertHandled(instanceId: string): boolean {
  return readHandledIds().includes(instanceId);
}

export function buildGamePath(lobbyCode: string): string {
  return `/game/${encodeURIComponent(lobbyCode.toUpperCase())}`;
}
