type AsyncTask = () => Promise<void>;

export class LobbyLifecycleQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private pendingTasks = 0;

  enqueue(lobbyId: string, task: AsyncTask): Promise<void> {
    this.pendingTasks += 1;
    const previous = this.tails.get(lobbyId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(task);

    this.tails.set(lobbyId, next);

    return next.finally(() => {
      this.pendingTasks = Math.max(0, this.pendingTasks - 1);
      if (this.tails.get(lobbyId) === next) {
        this.tails.delete(lobbyId);
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
