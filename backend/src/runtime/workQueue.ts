import { Queue } from 'bullmq';

export interface ScoringJobPayload {
  lobbyId: string;
  instanceId: string;
  enqueuedAt: string;
}

const QUEUE_NAME = 'motorsport-iq-game-jobs';

interface QueueRuntime {
  queue: Queue<ScoringJobPayload, void, string> | null;
}

let runtime: QueueRuntime | null = null;

export function getWorkQueueRuntime(): QueueRuntime {
  if (runtime) {
    return runtime;
  }

  const enabled = process.env.FF_JOB_QUEUE === 'true';
  const redisUrl = process.env.REDIS_URL;
  if (!enabled || !redisUrl) {
    runtime = { queue: null };
    return runtime;
  }

  runtime = {
    queue: new Queue<ScoringJobPayload, void, string>(QUEUE_NAME, {
      connection: {
        host: new URL(redisUrl).hostname,
        port: Number(new URL(redisUrl).port || 6379),
        username: new URL(redisUrl).username || undefined,
        password: new URL(redisUrl).password || undefined,
      },
    }),
  };

  return runtime ?? { queue: null };
}

export async function enqueueScoringJob(payload: ScoringJobPayload): Promise<void> {
  const queue = getWorkQueueRuntime().queue;
  if (!queue) {
    return;
  }

  await queue.add('score-instance', payload, {
    attempts: 3,
    removeOnComplete: 200,
    removeOnFail: 500,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  });
}
