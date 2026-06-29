import type { ConvexClient } from 'convex/browser';
import type { FunctionReference } from 'convex/server';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { runIncrementalSubscribeLive, runReconcilePollLive } from './feed-runtime.js';
import type { IncrementalFeedDef, PollPage } from './types.js';

type TestItem = { key: string; value: string };

const testQuery = 'test.query' as unknown as FunctionReference<'query'>;

describe('runIncrementalSubscribe', () => {
  it('invokes onItem for subscribed items and supports stop', async () => {
    const handled: string[] = [];
    let onUpdateCallback: ((result: unknown) => void) | undefined;

    const wsClient = {
      onUpdate: vi.fn((_query, _args, onUpdate) => {
        onUpdateCallback = onUpdate;
        return vi.fn();
      }),
    } as unknown as ConvexClient;

    const def: IncrementalFeedDef<TestItem, { id: string }> = {
      name: 'test',
      itemKey: (item) => item.key,
    };

    const handle = await Effect.runPromise(
      runIncrementalSubscribeLive({
        wsClient,
        def,
        target: {
          query: testQuery,
          buildArgs: (_args, afterKey, limit) => ({
            afterKey: afterKey ?? undefined,
            limit,
          }),
          parsePage: (result) => result as PollPage<TestItem>,
        },
        args: { id: 'machine-1' },
        buffer: { maxSize: 10, deliveryMode: 'fifo', dedupe: true },
        subscribe: { limit: 10 },
        onItem: ({ item, ack }) =>
          Effect.sync(() => {
            handled.push(item.value);
            ack();
          }),
      })
    );

    onUpdateCallback?.({
      items: [{ key: '001', value: 'first' }],
      highKey: '001',
      hasMore: false,
    });

    await Effect.runPromise(Effect.sleep('80 millis'));
    await Effect.runPromise(handle.stop());

    expect(handled).toContain('first');
    expect(wsClient.onUpdate).toHaveBeenCalled();
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
