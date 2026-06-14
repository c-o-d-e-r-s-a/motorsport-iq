const SUBSCRIBER_ID_KEY = 'msp_subscriber_id';

export function getSubscriberId(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  const existing = localStorage.getItem(SUBSCRIBER_ID_KEY);
  if (existing) {
    return existing;
  }

  const created = crypto.randomUUID();
  localStorage.setItem(SUBSCRIBER_ID_KEY, created);
  return created;
}
