import { LobbyLifecycleQueue } from './lifecycleQueue';

describe('LobbyLifecycleQueue', () => {
  it('runs tasks sequentially for the same lobby', async () => {
    const queue = new LobbyLifecycleQueue();
    const order: string[] = [];

    const first = queue.enqueue('lobby-a', async () => {
      order.push('first:start');
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push('first:end');
    });

    const second = queue.enqueue('lobby-a', async () => {
      order.push('second:start');
      order.push('second:end');
    });

    await Promise.all([first, second]);

    expect(order).toEqual([
      'first:start',
      'first:end',
      'second:start',
      'second:end',
    ]);
  });

  it('allows different lobbies to progress independently', async () => {
    const queue = new LobbyLifecycleQueue();
    const order: string[] = [];

    await Promise.all([
      queue.enqueue('lobby-a', async () => {
        order.push('a');
      }),
      queue.enqueue('lobby-b', async () => {
        order.push('b');
      }),
    ]);

    expect(order.sort()).toEqual(['a', 'b']);
  });
});
