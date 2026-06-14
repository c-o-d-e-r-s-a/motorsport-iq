import { apiFetch } from './api';
import {
  getHeadsUpNotificationOptions,
  getNotificationAssetPaths,
  shouldNotifyWhenBackgrounded,
} from './notificationDisplay';
import { buildGamePath, hasQuestionAlertHandled, markQuestionAlertHandled } from './questionAlerts';
import { getSocketClient } from './socket';
import { getSubscriberId } from './subscriberId';

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined'
    && 'Notification' in window
    && 'serviceWorker' in navigator;
}

export function getNotificationPermission(): NotificationPermission {
  if (!isNotificationSupported()) {
    return 'denied';
  }

  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) {
    return 'denied';
  }

  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }

  return Notification.requestPermission();
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
}

async function waitForActiveServiceWorker(
  registration: ServiceWorkerRegistration,
): Promise<ServiceWorkerRegistration> {
  if (registration.active) {
    return registration;
  }

  const worker = registration.installing ?? registration.waiting;
  if (worker) {
    await new Promise<void>((resolve) => {
      const onStateChange = () => {
        if (worker.state === 'activated') {
          worker.removeEventListener('statechange', onStateChange);
          resolve();
        }
      };
      worker.addEventListener('statechange', onStateChange);
      if (worker.state === 'activated') {
        worker.removeEventListener('statechange', onStateChange);
        resolve();
      }
    });
    return registration;
  }

  await navigator.serviceWorker.ready;
  return registration;
}

async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    return null;
  }

  let registration = await navigator.serviceWorker.getRegistration('/');
  if (!registration) {
    try {
      registration = await navigator.serviceWorker.register('/sw.js');
    } catch {
      return null;
    }
  }

  try {
    return await waitForActiveServiceWorker(registration);
  } catch {
    return null;
  }
}

async function fetchVapidPublicKey(): Promise<string | null> {
  try {
    const response = await apiFetch('/push/vapid-public-key');
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { publicKey?: string };
    return data.publicKey?.trim() ?? null;
  } catch {
    return null;
  }
}

function shouldNotifyInBackground(): boolean {
  return shouldNotifyWhenBackgrounded(document.visibilityState, document.hasFocus());
}

async function postQuestionNotificationToServiceWorker(payload: {
  title: string;
  body: string;
  tag: string;
  path: string;
}): Promise<void> {
  const registration = await getServiceWorkerRegistration();
  if (!registration) {
    return;
  }

  const worker = registration.active ?? registration.waiting ?? registration.installing;
  if (worker) {
    worker.postMessage({
      type: 'SHOW_QUESTION_NOTIFICATION',
      ...payload,
    });
    return;
  }

  await registration.showNotification(payload.title, {
    body: payload.body,
    ...getNotificationAssetPaths(window.location.origin),
    tag: payload.tag,
    data: { path: payload.path },
    ...getHeadsUpNotificationOptions(),
  } as NotificationOptions);
}

export async function showQuestionNotification(options: {
  questionText: string;
  lobbyCode: string;
  instanceId: string;
}): Promise<void> {
  if (!isNotificationSupported() || Notification.permission !== 'granted') {
    return;
  }

  if (!shouldNotifyInBackground()) {
    return;
  }

  if (hasQuestionAlertHandled(options.instanceId)) {
    return;
  }

  markQuestionAlertHandled(options.instanceId);

  const path = buildGamePath(options.lobbyCode);

  await postQuestionNotificationToServiceWorker({
    title: 'New prediction question!',
    body: options.questionText,
    tag: `question-${options.instanceId}`,
    path,
  });
}

async function persistPushSubscription(
  subscription: PushSubscriptionJSON,
  playerId?: string,
): Promise<boolean> {
  try {
    const response = await apiFetch('/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({
        subscriberId: getSubscriberId(),
        playerId,
        subscription,
      }),
    });

    return response.ok;
  } catch {
    return false;
  }
}

interface PushSubscriptionJSON {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export { getAndroidPopUpHint, isAndroidDevice } from './notificationDisplay';

export async function registerPushSubscriptionWithServer(options?: {
  playerId?: string;
}): Promise<boolean> {
  if (!isNotificationSupported() || Notification.permission !== 'granted') {
    return false;
  }

  const playerId = options?.playerId?.trim() || undefined;

  const publicKey = await fetchVapidPublicKey();
  if (!publicKey) {
    return false;
  }

  const registration = await getServiceWorkerRegistration();
  if (!registration?.active) {
    return false;
  }

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
    } catch {
      return false;
    }
  }

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return false;
  }

  const subscriptionPayload: PushSubscriptionJSON = {
    endpoint: json.endpoint,
    keys: {
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
  };

  const persisted = await persistPushSubscription(subscriptionPayload, playerId);
  if (!persisted) {
    return false;
  }

  if (playerId && getSocketClient().isConnected()) {
    getSocketClient().registerPushSubscription(subscriptionPayload);
  }

  return true;
}

export async function unregisterPushSubscriptionFromServer(): Promise<void> {
  const registration = await getServiceWorkerRegistration();
  const subscription = await registration?.pushManager.getSubscription();

  if (subscription?.endpoint) {
    try {
      await apiFetch('/push/unsubscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
    } catch {
      // Best-effort cleanup when backend is unreachable.
    }
  }

  await subscription?.unsubscribe();
}

export async function enableRaceAlerts(): Promise<boolean> {
  const permission = await requestNotificationPermission();
  if (permission !== 'granted') {
    return false;
  }

  return registerPushSubscriptionWithServer();
}
