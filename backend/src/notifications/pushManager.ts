import webpush from 'web-push';
import supabase from '../db/supabaseClient';
import { metrics } from '../observability/metrics';

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface QuestionPushPayload {
  instanceId: string;
  questionText: string;
  lobbyCode: string;
}

export interface BroadcastPushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
}

interface StoredSubscription extends PushSubscriptionRecord {
  subscriberId: string;
}

const subscriptionsByEndpoint = new Map<string, StoredSubscription>();

let pushEnabled = false;

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, max - 1).trim()}…`;
}

function isValidSubscription(subscription: PushSubscriptionRecord | null | undefined): subscription is PushSubscriptionRecord {
  return Boolean(
    subscription?.endpoint
    && subscription.keys?.p256dh
    && subscription.keys?.auth
  );
}

async function persistSubscription(subscriberId: string, subscription: PushSubscriptionRecord): Promise<void> {
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      subscriber_id: subscriberId,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    throw error;
  }
}

async function removeSubscriptionFromDatabase(endpoint: string): Promise<void> {
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint);

  if (error) {
    throw error;
  }
}

async function sendToSubscription(
  subscription: PushSubscriptionRecord,
  payload: string,
  successMetric: string,
  failureMetric: string
): Promise<void> {
  try {
    await webpush.sendNotification(subscription, payload, {
      urgency: 'high',
      TTL: 300,
    });
    metrics.incrementCounter(successMetric);
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) {
      subscriptionsByEndpoint.delete(subscription.endpoint);
      await removeSubscriptionFromDatabase(subscription.endpoint);
    }

    console.warn(`[Push] Failed for endpoint=${subscription.endpoint}:`, error);
    metrics.incrementCounter(failureMetric);
  }
}

export function initPushNotifications(): boolean {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:hello@motorsport-iq.vercel.app';

  if (!publicKey || !privateKey) {
    console.log('[Push] VAPID keys not configured — web push disabled');
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  pushEnabled = true;
  console.log('[Push] Web push enabled');
  return true;
}

export function isPushEnabled(): boolean {
  return pushEnabled;
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() ?? null;
}

export async function loadPushSubscriptionsFromDatabase(): Promise<void> {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth, subscriber_id');

  if (error) {
    console.warn('[Push] Failed to load subscriptions from database:', error.message);
    return;
  }

  subscriptionsByEndpoint.clear();

  for (const row of data ?? []) {
    if (!row.endpoint || !row.p256dh || !row.auth || !row.subscriber_id) {
      continue;
    }

    subscriptionsByEndpoint.set(row.endpoint, {
      endpoint: row.endpoint,
      keys: {
        p256dh: row.p256dh,
        auth: row.auth,
      },
      subscriberId: row.subscriber_id,
    });
  }

  console.log(`[Push] Loaded ${subscriptionsByEndpoint.size} subscription(s) from database`);
}

export async function registerPushSubscription(
  subscriberId: string,
  subscription: PushSubscriptionRecord
): Promise<void> {
  if (!isValidSubscription(subscription)) {
    return;
  }

  subscriptionsByEndpoint.set(subscription.endpoint, {
    ...subscription,
    subscriberId,
  });

  await persistSubscription(subscriberId, subscription);
  metrics.incrementCounter('push.subscription_registered_total');
}

export async function unregisterPushSubscriptionByEndpoint(endpoint: string): Promise<void> {
  if (!endpoint) {
    return;
  }

  subscriptionsByEndpoint.delete(endpoint);
  await removeSubscriptionFromDatabase(endpoint);
  metrics.incrementCounter('push.subscription_removed_total');
}

export async function unregisterPushSubscriptionsForSubscriber(subscriberId: string): Promise<void> {
  const endpoints = [...subscriptionsByEndpoint.entries()]
    .filter(([, subscription]) => subscription.subscriberId === subscriberId)
    .map(([endpoint]) => endpoint);

  for (const endpoint of endpoints) {
    await unregisterPushSubscriptionByEndpoint(endpoint);
  }
}

function getSubscriptionsForSubscribers(subscriberIds: string[]): PushSubscriptionRecord[] {
  const targetIds = new Set(subscriberIds);
  return [...subscriptionsByEndpoint.values()]
    .filter((subscription) => targetIds.has(subscription.subscriberId))
    .map(({ endpoint, keys }) => ({ endpoint, keys }));
}

export async function broadcastPushNotification(payload: BroadcastPushPayload): Promise<void> {
  if (!pushEnabled || subscriptionsByEndpoint.size === 0) {
    return;
  }

  const pushPayload = JSON.stringify({
    title: payload.title,
    body: truncate(payload.body, 180),
    tag: payload.tag,
    url: payload.url,
  });

  await Promise.allSettled(
    [...subscriptionsByEndpoint.values()].map((subscription) => sendToSubscription(
      subscription,
      pushPayload,
      'push.broadcast_sent_total',
      'push.broadcast_failed_total'
    ))
  );
}

export async function sendQuestionPushToPlayers(
  playerIds: string[],
  payload: QuestionPushPayload,
  _gameUrl: string
): Promise<void> {
  if (!pushEnabled) {
    return;
  }

  const subscriptions = getSubscriptionsForSubscribers(playerIds);
  if (subscriptions.length === 0) {
    return;
  }

  const pushPayload = JSON.stringify({
    title: 'New prediction question!',
    body: truncate(payload.questionText, 140),
    tag: `question-${payload.instanceId}`,
    path: `/game/${encodeURIComponent(payload.lobbyCode.toUpperCase())}`,
    instanceId: payload.instanceId,
  });

  await Promise.allSettled(
    subscriptions.map((subscription) => sendToSubscription(
      subscription,
      pushPayload,
      'push.question_sent_total',
      'push.question_failed_total'
    ))
  );
}
