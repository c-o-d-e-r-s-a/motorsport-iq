'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getSocketClient } from '@/lib/socket';
import {
  getResumePath,
  getStoredLobbySession,
  shouldAutoResumeRoute,
} from '@/lib/sessionPersistence';

/**
 * Restores lobby navigation after cold starts and keeps sessions alive across
 * backgrounding in PWAs and regular browser tabs.
 */
export function SessionResume() {
  const router = useRouter();
  const pathname = usePathname();
  const lastResumeAtRef = useRef(0);

  const sendBackgroundPresencePing = useCallback(() => {
    if (!getStoredLobbySession()) {
      return;
    }

    getSocketClient().sendPresencePing();
  }, []);

  const resumeSocketSession = useCallback(() => {
    const now = Date.now();
    if (now - lastResumeAtRef.current < 1500) {
      return;
    }
    lastResumeAtRef.current = now;

    const session = getStoredLobbySession();
    if (!session) {
      return;
    }

    const socket = getSocketClient();
    socket.resumeFromBackground();
    socket.reconnectLobby(session.userId);
    socket.sendPresencePing();
  }, []);

  useEffect(() => {
    if (!shouldAutoResumeRoute(pathname)) {
      return;
    }

    const session = getStoredLobbySession();
    if (!session) {
      return;
    }

    const resumePath = getResumePath(session);
    if (pathname === resumePath) {
      resumeSocketSession();
      return;
    }

    if (pathname === '/') {
      router.replace(resumePath);
    }
  }, [pathname, resumeSocketSession, router]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        resumeSocketSession();
        return;
      }

      sendBackgroundPresencePing();
    };

    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        resumeSocketSession();
      }
    };

    const handleFocus = () => {
      resumeSocketSession();
    };

    const handleFreeze = () => {
      sendBackgroundPresencePing();
    };

    const handleLifecycleResume = () => {
      resumeSocketSession();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('freeze', handleFreeze);
    document.addEventListener('resume', handleLifecycleResume);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('freeze', handleFreeze);
      document.removeEventListener('resume', handleLifecycleResume);
    };
  }, [resumeSocketSession, sendBackgroundPresencePing]);

  return null;
}
