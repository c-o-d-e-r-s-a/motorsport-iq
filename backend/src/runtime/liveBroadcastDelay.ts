/**
 * Delay live race telemetry and question triggers so gameplay aligns with F1 TV.
 * SignalR arrives ~3s after track events; F1 TV is typically ~20–25s behind the track.
 * Default 22s bridges that gap without lagging behind a ~20s F1 TV feed.
 */
export const DEFAULT_LIVE_BROADCAST_DELAY_MS = 22_000;

function parseNonNegativeNumberEnv(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

export const LIVE_BROADCAST_DELAY_MS = parseNonNegativeNumberEnv(
  process.env.LIVE_BROADCAST_DELAY_MS,
  DEFAULT_LIVE_BROADCAST_DELAY_MS
);

export function shouldDelayLiveBroadcast(snapshot: { sessionMode: string }): boolean {
  return snapshot.sessionMode === 'live' && LIVE_BROADCAST_DELAY_MS > 0;
}

export function getSnapshotTimestampMs(snapshot: { timestamp: Date }): number {
  const parsed = snapshot.timestamp.getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/** Wall-clock delay until a live snapshot should be shown to players. */
export function computeLiveBroadcastDelayMs(snapshot: { timestamp: Date; sessionMode: string }): number {
  if (!shouldDelayLiveBroadcast(snapshot)) {
    return 0;
  }

  const targetTime = getSnapshotTimestampMs(snapshot) + LIVE_BROADCAST_DELAY_MS;
  return Math.max(0, targetTime - Date.now());
}

export function scheduleLiveBroadcastAction(action: () => void | Promise<void>): void {
  if (LIVE_BROADCAST_DELAY_MS <= 0) {
    void action();
    return;
  }

  setTimeout(() => void action(), LIVE_BROADCAST_DELAY_MS);
}

export function scheduleDelayedLiveSnapshotEmit(
  snapshot: { timestamp: Date; sessionMode: string },
  emit: () => void
): void {
  const delayMs = computeLiveBroadcastDelayMs(snapshot);
  if (delayMs <= 0) {
    emit();
    return;
  }

  setTimeout(emit, delayMs);
}
