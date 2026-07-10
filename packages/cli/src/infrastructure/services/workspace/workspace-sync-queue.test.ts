import { afterEach, describe, expect, it, vi } from 'vitest';

import { enqueueFileTreeSync, resetFileTreeSyncQueuesForTests } from './workspace-sync-queue.js';

afterEach(() => {
  resetFileTreeSyncQueuesForTests();
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('enqueueFileTreeSync', () => {
  it('serializes syncs for the same workspace', async () => {
    const task = vi.fn(async () => {
      await delay(20);
    });

    const first = enqueueFileTreeSync('machine-1', '/workspace', task);
    const second = enqueueFileTreeSync('machine-1', '/workspace', task);

    await Promise.all([first, second]);

    expect(task).toHaveBeenCalledTimes(2);
  });

  it('coalesces rapid enqueues while running into one trailing resync', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const task = vi.fn(async () => {
      if (task.mock.calls.length === 1) {
        await firstGate;
      }
    });

    const running = enqueueFileTreeSync('machine-1', '/workspace', task);
    await delay(5);

    void enqueueFileTreeSync('machine-1', '/workspace', task);
    void enqueueFileTreeSync('machine-1', '/workspace', task);

    releaseFirst?.();
    await running;

    expect(task).toHaveBeenCalledTimes(2);
  });

  it('does not block different workspaces', async () => {
    const order: string[] = [];
    const taskA = vi.fn(async () => {
      order.push('a-start');
      await delay(30);
      order.push('a-end');
    });
    const taskB = vi.fn(async () => {
      order.push('b-start');
      await delay(5);
      order.push('b-end');
    });

    await Promise.all([
      enqueueFileTreeSync('machine-1', '/workspace-a', taskA),
      enqueueFileTreeSync('machine-1', '/workspace-b', taskB),
    ]);

    expect(taskA).toHaveBeenCalledTimes(1);
    expect(taskB).toHaveBeenCalledTimes(1);
    expect(order.indexOf('b-end')).toBeLessThan(order.indexOf('a-end'));
  });
});
