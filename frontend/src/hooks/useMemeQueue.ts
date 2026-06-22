import { useCallback, useEffect, useRef } from 'react';

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function useMemeQueue() {
  const correctFiles = useRef<string[]>([]);
  const wrongFiles = useRef<string[]>([]);
  const correctQueue = useRef<string[]>([]);
  const wrongQueue = useRef<string[]>([]);
  const fetched = useRef(false);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;

    fetch('/api/memes?type=correct')
      .then((r) => r.json())
      .then((data: { files: string[] }) => {
        correctFiles.current = data.files;
        correctQueue.current = shuffle(data.files);
      })
      .catch(() => {});

    fetch('/api/memes?type=wrong')
      .then((r) => r.json())
      .then((data: { files: string[] }) => {
        wrongFiles.current = data.files;
        wrongQueue.current = shuffle(data.files);
      })
      .catch(() => {});
  }, []);

  const getNextMeme = useCallback((isCorrect: boolean): string | null => {
    const files = isCorrect ? correctFiles.current : wrongFiles.current;
    if (files.length === 0) return null;

    const queue = isCorrect ? correctQueue.current : wrongQueue.current;
    if (queue.length === 0) {
      const refilled = shuffle(files);
      if (isCorrect) correctQueue.current = refilled;
      else wrongQueue.current = refilled;
      return refilled.shift() ?? null;
    }

    return queue.shift() ?? null;
  }, []);

  return { getNextMeme };
}
