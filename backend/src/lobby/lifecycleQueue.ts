type AsyncTask = () => Promise<void>;

export class LobbyLifecycleQueue {
  private readonly tails = new Map<string, Promise<void>>();

  enqueue(lobbyId: string, task: AsyncTask): Promise<void> {
    const previous = this.tails.get(lobbyId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(task);

    this.tails.set(lobbyId, next);

    return next.finally(() => {
      if (this.tails.get(lobbyId) === next) {
        this.tails.delete(lobbyId);
      }
    });
  }
}
