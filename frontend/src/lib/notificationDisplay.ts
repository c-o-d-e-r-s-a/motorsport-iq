export function shouldNotifyWhenBackgrounded(
  visibilityState: DocumentVisibilityState,
  hasFocus: boolean,
): boolean {
  return visibilityState === 'hidden' || !hasFocus;
}

export interface NotificationClientLike {
  url: string;
  visibilityState: DocumentVisibilityState;
  focused?: boolean;
}

/** Suppress only when a /game/ tab is actually foregrounded (not merely "visible" on mobile). */
export function shouldSuppressQuestionNotification(clients: NotificationClientLike[]): boolean {
  return clients.some((client) => {
    if (!client.url.includes('/game/')) {
      return false;
    }

    return Boolean(client.focused) && client.visibilityState === 'visible';
  });
}

export function getNotificationAssetPaths(origin: string): {
  icon: string;
  badge: string;
} {
  return {
    icon: `${origin}/notification-icon.png`,
    badge: `${origin}/notification-badge.png`,
  };
}

export interface HeadsUpNotificationOptions {
  requireInteraction: boolean;
  renotify: boolean;
  silent: boolean;
  vibrate: number[];
}

/** Heads-up-friendly options shared by the service worker and page fallback. */
export function getHeadsUpNotificationOptions(): HeadsUpNotificationOptions {
  return {
    requireInteraction: false,
    renotify: true,
    silent: false,
    vibrate: [200, 100, 200, 100, 200],
  };
}

export function isAndroidDevice(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
}

export function getAndroidPopUpHint(appLabel = 'Motorsport IQ'): string {
  return `For banner alerts at the top of your screen: Settings → Apps → ${appLabel} (or Chrome if using the browser) → Notifications → enable "Show as pop-up" / "Pop on screen".`;
}
