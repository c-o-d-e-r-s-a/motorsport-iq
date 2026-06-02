import type Redis from 'ioredis';

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

function randomToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface DistributedLockManager {
  acquire(key: string, ttlMs: number): Promise<string | null>;
  release(key: string, token: string): Promise<void>;
}

class RedisDistributedLockManager implements DistributedLockManager {
  constructor(private readonly redis: Redis) {}

  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const token = randomToken();
    const result = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? token : null;
  }

  async release(key: string, token: string): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, 1, key, token);
  }
}

class NoopDistributedLockManager implements DistributedLockManager {
  async acquire(_key: string, _ttlMs: number): Promise<string | null> {
    return 'noop';
  }

  async release(_key: string, _token: string): Promise<void> {
    return;
  }
}

export function createDistributedLockManager(redisClient?: Redis): DistributedLockManager {
  if (!redisClient) {
    return new NoopDistributedLockManager();
  }

  return new RedisDistributedLockManager(redisClient);
}
