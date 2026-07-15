/**
 * Accepts one lifecycle evaluation per lobby/session/lap.
 *
 * The live timing feed reports a completed lap from several drivers, so a
 * single race lap can otherwise enqueue the same lifecycle work repeatedly.
 * Keeping only the newest accepted lap makes that work idempotent and bounds
 * the state to one small entry per active lobby.
 */
export class LapProcessingGate {
  private readonly latestByLobby = new Map<string, { sessionId: string; lapNumber: number }>();

  claim(lobbyId: string, sessionId: string, lapNumber: number): boolean {
    if (!Number.isFinite(lapNumber) || lapNumber < 1) {
      return false;
    }

    const existing = this.latestByLobby.get(lobbyId);
    if (existing?.sessionId === sessionId && lapNumber <= existing.lapNumber) {
      return false;
    }

    this.latestByLobby.set(lobbyId, { sessionId, lapNumber });
    return true;
  }

  clear(lobbyId: string): void {
    this.latestByLobby.delete(lobbyId);
  }

  get size(): number {
    return this.latestByLobby.size;
  }
}
