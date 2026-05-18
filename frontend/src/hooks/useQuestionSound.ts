import { useEffect, useRef, useState } from 'react';

export function useQuestionSound(soundPath: string) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [canAutoplay, setCanAutoplay] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const audio = new Audio(soundPath);
    audio.preload = 'auto';
    audioRef.current = audio;

    const testAutoplay = async () => {
      try {
        await audio.play();
        await audio.pause();
        audio.currentTime = 0;
        setCanAutoplay(true);
      } catch (error) {
        setCanAutoplay(false);
      }
    };

    testAutoplay();

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [soundPath]);

  const playSound = () => {
    if (!audioRef.current) return;

    audioRef.current.currentTime = 0;
    
    audioRef.current.play().catch((error) => {
      console.warn('[Audio] Playback blocked:', error.message);
      if (canAutoplay === null || canAutoplay === true) {
        setCanAutoplay(false);
      }
    });
  };

  return { playSound, canAutoplay };
}
