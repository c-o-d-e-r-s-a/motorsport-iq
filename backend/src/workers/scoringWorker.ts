import { Worker } from 'bullmq';

const redisUrl = process.env.REDIS_URL;
const queueEnabled = process.env.FF_JOB_QUEUE === 'true';

if (!queueEnabled || !redisUrl) {
  console.log('[scoring-worker] Disabled (FF_JOB_QUEUE=false or REDIS_URL missing).');
  process.exit(0);
}

const redisConfig = new URL(redisUrl);
const connection = {
  host: redisConfig.hostname,
  port: Number(redisConfig.port || 6379),
  username: redisConfig.username || undefined,
  password: redisConfig.password || undefined,
};

const worker = new Worker(
  'motorsport-iq-game-jobs',
  async (job) => {
    // Placeholder worker for phase-3 service split.
    // Current scoring remains inline in lifecycleManager for backwards compatibility.
    console.log(`[scoring-worker] Received job ${job.id} (${job.name})`, job.data);
  },
  { connection }
);

worker.on('completed', (job) => {
  console.log(`[scoring-worker] Completed job ${job.id}`);
});

worker.on('failed', (job, error) => {
  console.error(`[scoring-worker] Failed job ${job?.id}:`, error.message);
});

process.on('SIGINT', async () => {
  await worker.close();
  process.exit(0);
});
