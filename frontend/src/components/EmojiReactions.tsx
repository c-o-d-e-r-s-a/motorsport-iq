'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocketClient } from '@/lib/socket';
import { REACTION_EMOJIS, SERVER_EVENTS, type EmojiReactionEvent } from '@/lib/types';
import { cn } from '@/lib/cn';

interface FloatingReaction {
  id: number;
  emoji: string;
  left: number;
  sway: number;
  swayDuration: number;
  riseDuration: number;
}

interface EmojiReactionsProps {
  /** Only render and wire up listeners when the player is actually in a lobby room. */
  enabled?: boolean;
  /** Distance in px to lift the launcher above the bottom safe area (clears sticky bars). */
  bottomOffset?: number;
}

const MAX_ON_SCREEN = 36;
const SEND_THROTTLE_MS = 220;
const MUTE_STORAGE_KEY = 'msp_reactions_muted';

export default function EmojiReactions({ enabled = true, bottomOffset = 20 }: EmojiReactionsProps) {
  const [floating, setFloating] = useState<FloatingReaction[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const idRef = useRef(0);
  const lastSentRef = useRef(0);
  const mutedRef = useRef(false);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // Hydrate the saved preference after mount to keep SSR markup deterministic.
  useEffect(() => {
    setMuted(localStorage.getItem(MUTE_STORAGE_KEY) === '1');
  }, []);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const spawn = useCallback((emoji: string) => {
    if (mutedRef.current) {
      return;
    }
    const id = idRef.current++;
    const reaction: FloatingReaction = {
      id,
      emoji,
      left: Math.round(Math.random() * 64), // px band so reactions fan out from the button
      sway: Math.round(8 + Math.random() * 16),
      swayDuration: Math.round(950 + Math.random() * 700),
      riseDuration: Math.round(2200 + Math.random() * 900),
    };

    setFloating((current) => {
      const next = [...current, reaction];
      return next.length > MAX_ON_SCREEN ? next.slice(next.length - MAX_ON_SCREEN) : next;
    });

    const timer = setTimeout(() => {
      setFloating((current) => current.filter((item) => item.id !== id));
      timersRef.current.delete(timer);
    }, reaction.riseDuration + 150);
    timersRef.current.add(timer);
  }, []);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const socket = getSocketClient();
    const unsubscribe = socket.on(SERVER_EVENTS.EMOJI_REACTION, (data: EmojiReactionEvent) => {
      if (data && typeof data.emoji === 'string') {
        spawn(data.emoji);
      }
    });

    return unsubscribe;
  }, [enabled, spawn]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const handleSend = useCallback(
    (emoji: string) => {
      const now = Date.now();
      if (now - lastSentRef.current < SEND_THROTTLE_MS) {
        return;
      }
      lastSentRef.current = now;
      spawn(emoji);
      getSocketClient().sendReaction(emoji);
    },
    [spawn]
  );

  const toggleMuted = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      localStorage.setItem(MUTE_STORAGE_KEY, next ? '1' : '0');
      if (next) {
        // Clear anything mid-flight so the screen calms immediately.
        timersRef.current.forEach((timer) => clearTimeout(timer));
        timersRef.current.clear();
        setFloating([]);
      }
      return next;
    });
  }, []);

  if (!enabled) {
    return null;
  }

  const launcherBottom = `calc(var(--safe-bottom, 0px) + ${bottomOffset}px)`;

  return (
    <>
      {/* Floating reaction layer — rises from just above the launcher. */}
      <div
        aria-hidden
        className="pointer-events-none fixed right-3 z-30 h-0 w-[112px]"
        style={{ bottom: `calc(${launcherBottom} + 52px)` }}
      >
        {floating.map((reaction) => (
          <span
            key={reaction.id}
            className="react-rise absolute bottom-0 will-change-transform"
            style={{ left: `${reaction.left}px`, ['--rise-dur' as string]: `${reaction.riseDuration}ms` }}
          >
            <span
              className="react-sway block text-[2rem] leading-none drop-shadow-[0_4px_12px_rgba(0,0,0,0.55)]"
              style={{
                ['--sway' as string]: `${reaction.sway}px`,
                ['--sway-dur' as string]: `${reaction.swayDuration}ms`,
              }}
            >
              {reaction.emoji}
            </span>
          </span>
        ))}
      </div>

      {/* Launcher + picker */}
      <div className="fixed right-3 z-40 flex flex-col items-end gap-2" style={{ bottom: launcherBottom }}>
        {isOpen && (
          <div className="react-pop surface-elevated flex max-w-[80vw] flex-col items-end gap-1.5 rounded-[var(--radius-lg)] p-2 shadow-[var(--shadow-lg)]">
            {muted ? (
              <p className="px-2 py-1 text-xs text-[var(--color-muted-fg)]">Reactions are off</p>
            ) : (
              <div className="flex flex-wrap justify-end gap-1">
                {REACTION_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handleSend(emoji)}
                    aria-label={`React with ${emoji}`}
                    className="flex h-11 w-11 items-center justify-center rounded-full text-2xl transition-transform duration-[var(--dur-fast)] hover:scale-110 hover:bg-[var(--color-muted)] active:scale-90"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={toggleMuted}
              className="mt-0.5 flex items-center gap-1.5 self-end rounded-[var(--radius-pill)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-muted-fg)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)]"
            >
              {muted ? '🔔 Turn reactions on' : '🔕 Turn reactions off'}
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          aria-label={isOpen ? 'Close reactions' : muted ? 'Reactions are off' : 'Send a reaction'}
          aria-expanded={isOpen}
          className={cn(
            'flex h-12 w-12 items-center justify-center rounded-full border text-2xl shadow-[var(--shadow)] backdrop-blur transition-all duration-[var(--dur-fast)] active:scale-90',
            isOpen
              ? 'rotate-90 border-[var(--color-accent)]/50 bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
              : 'border-[var(--color-border-strong)] bg-[var(--color-elevated)]/90 hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-elevated)]'
          )}
        >
          {isOpen ? '✕' : muted ? '🔕' : '🎉'}
        </button>
      </div>
    </>
  );
}
