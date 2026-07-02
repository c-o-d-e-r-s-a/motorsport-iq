import type { Request } from 'express';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

type LoginRateLimitBucket = {
  failures: number;
  windowStart: number;
};

const loginFailureBuckets = new Map<string, LoginRateLimitBucket>();

function getOrCreateBucket(ip: string, now = Date.now()): LoginRateLimitBucket {
  const existing = loginFailureBuckets.get(ip);
  if (!existing || now - existing.windowStart >= LOGIN_WINDOW_MS) {
    const bucket = { failures: 0, windowStart: now };
    loginFailureBuckets.set(ip, bucket);
    return bucket;
  }

  return existing;
}

export function getRequestClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }

  if (Array.isArray(forwarded) && forwarded[0]) {
    return forwarded[0].trim();
  }

  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function isAdminLoginRateLimited(ip: string): { limited: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const bucket = getOrCreateBucket(ip, now);

  if (bucket.failures < LOGIN_MAX_FAILURES) {
    return { limited: false };
  }

  return {
    limited: true,
    retryAfterMs: Math.max(0, bucket.windowStart + LOGIN_WINDOW_MS - now),
  };
}

export function recordAdminLoginFailure(ip: string): void {
  const bucket = getOrCreateBucket(ip);
  bucket.failures += 1;
}

export function clearAdminLoginRateLimit(ip: string): void {
  loginFailureBuckets.delete(ip);
}

export function resetAdminLoginRateLimitsForTests(): void {
  loginFailureBuckets.clear();
}
