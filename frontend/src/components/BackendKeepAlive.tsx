'use client';

import { useEffect } from 'react';
import { getApiUrl } from '@/lib/api';

/** Slightly under Render's ~15 min idle spin-down. */
const PING_INTERVAL_MS = 10 * 60 * 1000;

async function pingBackend(): Promise<void> {
  try {
    await fetch(getApiUrl('/health/scaling'), { method: 'GET', cache: 'no-store' });
  } catch {
    // Ignore — backend may be waking or unreachable.
  }
}

/**
 * Keeps the production Render backend warm while users have the app open.
 * Scheduled GitHub Actions pings cover idle periods (see keep-backend-warm.yml).
 */
export function BackendKeepAlive() {
  useEffect(() => {
    if (window.location.hostname === 'localhost') return;

    void pingBackend();
    const timer = setInterval(() => void pingBackend(), PING_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return null;
}
