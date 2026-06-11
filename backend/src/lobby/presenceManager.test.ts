import { PresenceManager } from './presenceManager';

describe('PresenceManager', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('expires connected users after inactivity timeout', async () => {
    const onExpire = jest.fn();
    const manager = new PresenceManager({
      inactivityTimeoutMs: 5_000,
      disconnectGraceMs: 1_000,
      sweepIntervalMs: 1_000,
      onExpire,
    });

    manager.upsertConnection({ userId: 'user-1', lobbyId: 'lobby-1', socketId: 'socket-1' });

    await jest.advanceTimersByTimeAsync(5_000);

    expect(onExpire).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        lobbyId: 'lobby-1',
        socketId: 'socket-1',
        connected: true,
      }),
      'inactive'
    );

    manager.stop();
  });

  it('does not expire reconnected users within the disconnect grace period', async () => {
    const onExpire = jest.fn();
    const manager = new PresenceManager({
      inactivityTimeoutMs: 60_000,
      disconnectGraceMs: 5_000,
      sweepIntervalMs: 1_000,
      onExpire,
    });

    manager.upsertConnection({ userId: 'user-1', lobbyId: 'lobby-1', socketId: 'socket-1' });
    manager.markDisconnectedBySocket('socket-1');
    await jest.advanceTimersByTimeAsync(2_000);
    manager.upsertConnection({ userId: 'user-1', lobbyId: 'lobby-1', socketId: 'socket-2' });
    await jest.advanceTimersByTimeAsync(5_000);

    expect(onExpire).not.toHaveBeenCalled();

    manager.stop();
  });

  it('retains disconnected users after grace expiry and only expires them on inactivity timeout', async () => {
    const onExpire = jest.fn();
    const manager = new PresenceManager({
      inactivityTimeoutMs: 60_000,
      disconnectGraceMs: 5_000,
      sweepIntervalMs: 1_000,
      onExpire,
    });

    manager.upsertConnection({ userId: 'user-1', lobbyId: 'lobby-1', socketId: 'socket-1' });
    manager.markDisconnectedBySocket('socket-1');

    await jest.advanceTimersByTimeAsync(5_000);
    expect(onExpire).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(55_000);
    expect(onExpire).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        lobbyId: 'lobby-1',
        socketId: null,
        connected: false,
      }),
      'inactive'
    );

    manager.stop();
  });

  it('reports active presence for a lobby with a recent heartbeat', () => {
    const manager = new PresenceManager({
      inactivityTimeoutMs: 5_000,
      onExpire: jest.fn(),
    });

    manager.upsertConnection({ userId: 'user-1', lobbyId: 'lobby-1', socketId: 'socket-1' });

    expect(manager.hasActivePresence('lobby-1')).toBe(true);
    expect(manager.hasActivePresence('lobby-2')).toBe(false);

    manager.stop();
  });

  it('uses a longer inactivity threshold when configured per entry', async () => {
    const onExpire = jest.fn();
    const manager = new PresenceManager({
      inactivityTimeoutMs: 5_000,
      maxInactivityTimeoutMs: 20_000,
      resolveInactivityTimeoutMs: async (entry) => (
        entry.lobbyId === 'lobby-active' ? 20_000 : 5_000
      ),
      sweepIntervalMs: 1_000,
      onExpire,
    });

    manager.upsertConnection({ userId: 'user-1', lobbyId: 'lobby-active', socketId: 'socket-1' });

    await jest.advanceTimersByTimeAsync(5_000);
    expect(onExpire).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(15_000);
    expect(onExpire).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', lobbyId: 'lobby-active' }),
      'inactive'
    );

    manager.stop();
  });

  it('removes all tracked users for a lobby', () => {
    const manager = new PresenceManager({
      onExpire: jest.fn(),
    });

    manager.upsertConnection({ userId: 'user-1', lobbyId: 'lobby-1', socketId: 'socket-1' });
    manager.upsertConnection({ userId: 'user-2', lobbyId: 'lobby-1', socketId: 'socket-2' });
    manager.upsertConnection({ userId: 'user-3', lobbyId: 'lobby-2', socketId: 'socket-3' });

    manager.removeLobby('lobby-1');

    expect(manager.getEntry('user-1')).toBeNull();
    expect(manager.getEntry('user-2')).toBeNull();
    expect(manager.getEntry('user-3')).not.toBeNull();

    manager.stop();
  });
});
