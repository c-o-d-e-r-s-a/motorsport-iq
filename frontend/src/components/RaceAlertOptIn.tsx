'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  enableRaceAlerts,
  getNotificationPermission,
  isNotificationSupported,
} from '@/lib/notifications';
import { Button } from '@/components/ui';
import NotificationPopUpHint from '@/components/NotificationPopUpHint';

export default function RaceAlertOptIn() {
  const [mounted, setMounted] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isEnabling, setIsEnabling] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [showPopUpHint, setShowPopUpHint] = useState(false);
  const [subscribeFailed, setSubscribeFailed] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setMounted(true);
    setPermission(getNotificationPermission());
    setDismissed(localStorage.getItem('msp_race_alerts_dismissed') === '1');
  }, []);

  const handleEnable = useCallback(async () => {
    setIsEnabling(true);
    try {
      const success = await enableRaceAlerts();
      const nextPermission = getNotificationPermission();
      setPermission(nextPermission);
      setEnabled(success);
      setShowPopUpHint(success);
      setSubscribeFailed(!success && nextPermission === 'granted');
      if (success) {
        localStorage.removeItem('msp_race_alerts_dismissed');
      }
    } finally {
      setIsEnabling(false);
    }
  }, []);

  const handleDismiss = useCallback(() => {
    localStorage.setItem('msp_race_alerts_dismissed', '1');
    setDismissed(true);
  }, []);

  if (!mounted || !isNotificationSupported() || dismissed || permission === 'denied') {
    return null;
  }

  if (enabled && showPopUpHint) {
    return (
      <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
        <p className="text-sm font-semibold text-[var(--color-fg)]">Race alerts enabled</p>
        <NotificationPopUpHint visible />
      </div>
    );
  }

  if (enabled) {
    return null;
  }

  if (permission !== 'default' && !subscribeFailed) {
    return null;
  }

  const isRetry = permission === 'granted' && subscribeFailed;

  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-[var(--color-fg)]">
            {isRetry ? 'Race alerts need another try' : 'Never miss a race day'}
          </p>
          <p className="mt-1 text-sm text-[var(--color-muted-fg)]">
            {isRetry
              ? 'Permission is on, but push registration did not complete. Tap retry to finish setup.'
              : 'Get a fun heads-up 30 minutes before every live Grand Prix.'}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {!isRetry && (
            <Button type="button" variant="ghost" size="sm" onClick={handleDismiss}>
              Not now
            </Button>
          )}
          <Button type="button" size="sm" disabled={isEnabling} onClick={() => void handleEnable()}>
            {isEnabling ? 'Enabling…' : isRetry ? 'Retry alerts' : 'Enable race alerts'}
          </Button>
        </div>
      </div>
    </div>
  );
}
