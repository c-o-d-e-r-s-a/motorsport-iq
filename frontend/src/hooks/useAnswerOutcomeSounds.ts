import { useCallback, useEffect, useRef } from 'react';

export function useAnswerOutcomeSounds() {
  const correctAudioRef = useRef<HTMLAudioElement | null>(null);
  const wrongAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const correctAudio = new Audio('/sounds/correct.mp3');
    const wrongAudio = new Audio('/sounds/wrong.mp3');

    correctAudio.preload = 'auto';
    wrongAudio.preload = 'auto';

    correctAudioRef.current = correctAudio;
    wrongAudioRef.current = wrongAudio;

    return () => {
      if (correctAudioRef.current) {
        correctAudioRef.current.pause();
        correctAudioRef.current = null;
      }
      if (wrongAudioRef.current) {
        wrongAudioRef.current.pause();
        wrongAudioRef.current = null;
      }
    };
  }, []);

  const playCorrectSound = useCallback(() => {
    if (!correctAudioRef.current) return;

    correctAudioRef.current.currentTime = 0;
    correctAudioRef.current.play().catch((error) => {
      console.warn('[Audio] Correct answer sound blocked:', error.message);
    });
  }, []);

  const playWrongSound = useCallback(() => {
    if (!wrongAudioRef.current) return;

    wrongAudioRef.current.currentTime = 0;
    wrongAudioRef.current.play().catch((error) => {
      console.warn('[Audio] Wrong answer sound blocked:', error.message);
    });
  }, []);

  return { playCorrectSound, playWrongSound };
}
