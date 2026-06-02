import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';

export interface RedisRuntime {
  pub: Redis;
  sub: Redis;
  attachSocketIoAdapter: ReturnType<typeof createAdapter>;
}

export function createRedisRuntime(): RedisRuntime | null {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return null;
  }

  const pub = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  const sub = pub.duplicate();

  return {
    pub,
    sub,
    attachSocketIoAdapter: createAdapter(pub, sub),
  };
}

export async function closeRedisRuntime(runtime: RedisRuntime | null): Promise<void> {
  if (!runtime) {
    return;
  }

  await Promise.allSettled([
    runtime.pub.quit(),
    runtime.sub.quit(),
  ]);
}
