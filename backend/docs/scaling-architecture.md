# Service Split Blueprint

## Current Runtime

- Socket transport, race ingestion, question lifecycle, and scoring all run in `backend/src/server.ts`.

## Phase-3 Separation

- **Race Ingest Service**
  - Maintains upstream SignalR/OpenF1 stream connection.
  - Publishes normalized snapshots into Redis channels.
- **Socket Gateway Nodes**
  - Handle client sockets and room fanout only.
  - Subscribe to Redis snapshot channels and emit to lobbies.
- **Game Workers**
  - Consume lap-complete and scoring jobs from queue.
  - Execute lifecycle transitions and leaderboard updates.

## Feature Flags Supporting Transition

- `FF_REDIS_ADAPTER=true` enables multi-node Socket.IO fanout.
- `FF_JOB_QUEUE=true` enables queued game job wiring (`runtime/workQueue.ts` and `workers/scoringWorker.ts`).

## Migration Sequence

1. Enable Redis adapter in staging.
2. Enable queue producer while keeping inline execution.
3. Run dedicated scoring worker process.
4. Move lap-complete work to workers.
5. Isolate ingest into a singleton process.
