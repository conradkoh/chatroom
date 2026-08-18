import { afterEach, describe, expect, it, vi } from 'vitest';

import { enqueueFileTreeSync, resetFileTreeSyncQueuesForTests } from './workspace-sync-queue.js';

afterEach(() => {
  resetFileTreeSyncQueuesForTests();
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const noDebounce = { debounceMs: 0 };

describe('enqueueFileTreeSync', () => {
  it('serializes syncs for the same workspace', async () => {
    const task = vi.fn(async () => {
      await delay(20);
    });

    const first = enqueueFileTreeSync('machine-1', '/workspace', task, noDebounce);
    await delay(5);
    const second = enqueueFileTreeSync('machine-1', '/workspace', task, noDebounce);

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

    const running = enqueueFileTreeSync('machine-1', '/workspace', task, noDebounce);
    await delay(5);

    void enqueueFileTreeSync('machine-1', '/workspace', task, noDebounce);
    void enqueueFileTreeSync('machine-1', '/workspace', task, noDebounce);

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
      enqueueFileTreeSync('machine-1', '/workspace-a', taskA, noDebounce),
      enqueueFileTreeSync('machine-1', '/workspace-b', taskB, noDebounce),
    ]);

    expect(taskA).toHaveBeenCalledTimes(1);
    expect(taskB).toHaveBeenCalledTimes(1);
    expect(order.indexOf('b-end')).toBeLessThan(order.indexOf('a-end'));
  });

  it('waits at least debounceMs between consecutive sync runs', async () => {
    const task = vi.fn(async () => undefined);
    const debounceMs = 50;

    await enqueueFileTreeSync('machine-1', '/workspace', task, { debounceMs });
    expect(task).toHaveBeenCalledTimes(1);

    const second = enqueueFileTreeSync('machine-1', '/workspace', task, { debounceMs });
    await delay(30);
    expect(task).toHaveBeenCalledTimes(1);

    await second;
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('coalesces synchronous rapid enqueues into one run', async () => {
    const task = vi.fn(async () => undefined);

    const first = enqueueFileTreeSync('machine-1', '/workspace', task, { debounceMs: 5_000 });
    const second = enqueueFileTreeSync('machine-1', '/workspace', task, { debounceMs: 5_000 });
    await Promise.all([first, second]);

    expect(task).toHaveBeenCalledTimes(1);
  });
});
