import { describe, expect, it } from 'vitest';

import { createKeyedCoalescingStateOutboxRegistry } from './keyed-coalescing-state-outbox-registry.js';

describe('keyed coalescing state outbox registry', () => {
  it('keeps delivery keys independent while coalescing each key', async () => {
    let release!: () => void;
    const first = new Promise<void>((resolve) => { release = resolve; });
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
});
