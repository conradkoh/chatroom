import { describe, expect, it, vi } from 'vitest';

import { createKeyedCoalescingStateOutboxRegistry } from './keyed-coalescing-state-outbox-registry.js';

describe('keyed coalescing state outbox registry', () => {
  it('keeps delivery keys independent while coalescing each key', async () => {
    let release!: () => void;
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sends: string[] = [];
    const registry = createKeyedCoalescingStateOutboxRegistry<string, string>({
      createSend: (key) => async (state) => {
        sends.push(`${key}:${state}`);
        if (key === 'a' && state === '1') await first;
        return state;
      },
      minIntervalMs: 0,
    });
    const a1 = registry.enqueue('a', '1');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const a2 = registry.enqueue('a', '2');
    const b = registry.enqueue('b', 'b');
    await expect(b).resolves.toBe('b');
    release();
    await expect(a1).resolves.toBe('1');
    await expect(a2).resolves.toBe('2');
    expect(sends).toEqual(['a:1', 'b:b', 'a:2']);
    await registry.stopAll();
  });

  it('stops only the selected key after flushing its pending state', async () => {
    const registry = createKeyedCoalescingStateOutboxRegistry<number, number>({
      createSend: () => async (state) => state,
      minIntervalMs: 100,
    });
    const pending = registry.enqueue('a', 1);
    await registry.stop('a');
    await expect(pending).resolves.toBe(1);
    await expect(registry.enqueue('b', 2)).resolves.toBe(2);
    await registry.stopAll();
  });

  it('backs off retries independently per workspace key', async () => {
    vi.useFakeTimers();
    const sendByKey = {
      '/ws-a': vi.fn<(state: number) => Promise<number>>().mockRejectedValue(new Error('ws-a')),
      '/ws-b': vi.fn<(state: number) => Promise<number>>().mockResolvedValue(1),
    };
    const registry = createKeyedCoalescingStateOutboxRegistry<number, number>({
      createSend: (key) => sendByKey[key as '/ws-a' | '/ws-b'],
      minIntervalMs: 0,
      retryDelayMs: 50,
      maxRetryDelayMs: 200,
    });

    void registry.enqueue('/ws-a', 1).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(sendByKey['/ws-a']).toHaveBeenCalledTimes(1);

    const otherWorkspace = registry.enqueue('/ws-b', 1);
    await vi.advanceTimersByTimeAsync(0);
    await expect(otherWorkspace).resolves.toBe(1);
    expect(sendByKey['/ws-b']).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(49);
    expect(sendByKey['/ws-a']).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sendByKey['/ws-a']).toHaveBeenCalledTimes(2);

    await registry.stopAll();
    vi.useRealTimers();
  });
});
