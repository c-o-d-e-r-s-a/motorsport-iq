import { metrics } from '../observability/metrics';

type AsyncTask = () => Promise<void>;

export class LobbyLifecycleQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private pendingTasks = 0;

  enqueue(lobbyId: string, task: AsyncTask): Promise<void> {
    this.pendingTasks += 1;
    metrics.setGauge('runtime.lifecycle_pending_tasks', this.pendingTasks);
    const enqueuedAt = Date.now();
    const previous = this.tails.get(lobbyId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        metrics.recordDuration('runtime.lifecycle_queue_wait_ms', Date.now() - enqueuedAt);
        const startedAt = Date.now();
        try {
          await task();
        } finally {
          metrics.recordDuration('runtime.lifecycle_task_ms', Date.now() - startedAt);
        }
      });

    this.tails.set(lobbyId, next);

    return next.finally(() => {
      this.pendingTasks = Math.max(0, this.pendingTasks - 1);
      metrics.setGauge('runtime.lifecycle_pending_tasks', this.pendingTasks);
      metrics.setGauge('runtime.lifecycle_active_lobbies', this.tails.size);
      if (this.tails.get(lobbyId) === next) {
        this.tails.delete(lobbyId);
        metrics.setGauge('runtime.lifecycle_active_lobbies', this.tails.size);
      }
    });
  }

  getActiveLobbyCount(): number {
    return this.tails.size;
  }

  getPendingTaskCount(): number {
    return this.pendingTasks;
  }
}
