import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { runIncrementalFeedLive, runReconcilePollLive } from './feed-runtime.js';
import type { IncrementalFeedDef, PollPage, PollRequest } from './types.js';

type TestItem = { key: string; value: string };

describe('runIncrementalFeed', () => {
  it('invokes onItem for polled items and supports stop', async () => {
    const handled: string[] = [];
    let pollCount = 0;

    const def: IncrementalFeedDef<TestItem, { id: string }> = {
      name: 'test',
      poll: async (_req: PollRequest<{ id: string }>): Promise<PollPage<TestItem>> => {
        pollCount++;
        if (pollCount === 1) {
          return {
            items: [{ key: '001', value: 'first' }],
            highKey: '001',
            hasMore: false,
          };
        }
        return { items: [], highKey: null, hasMore: false };
      },
      itemKey: (item) => item.key,
    };

    const handle = await Effect.runPromise(
      runIncrementalFeedLive({
        def,
        args: { id: 'machine-1' },
        buffer: { maxSize: 10, deliveryMode: 'fifo', dedupe: true },
        poll: { intervalMs: 5, limit: 10, backoff: { initialMs: 1, maxMs: 10 } },
        onItem: ({ item, ack }) =>
          Effect.sync(() => {
            handled.push(item.value);
            ack();
          }),
      })
    );

    await Effect.runPromise(Effect.sleep('80 millis'));
    await Effect.runPromise(handle.stop());

    expect(handled).toContain('first');
    expect(pollCount).toBeGreaterThanOrEqual(1);
  });
});

describe('runReconcilePoll', () => {
  it('polls on interval and calls onResult', async () => {
    let pollCount = 0;
    const results: number[] = [];

    const handle = await Effect.runPromise(
      runReconcilePollLive({
        name: 'reconcile-test',
        poll: async () => {
          pollCount++;
          return pollCount;
        },
        args: {},
        intervalMs: 10,
        onResult: (n) => Effect.sync(() => results.push(n)),
      })
    );

    await Effect.runPromise(Effect.sleep('50 millis'));
    await Effect.runPromise(handle.stop());

    expect(pollCount).toBeGreaterThanOrEqual(2);
    expect(results.length).toBeGreaterThanOrEqual(2);
  });
});
