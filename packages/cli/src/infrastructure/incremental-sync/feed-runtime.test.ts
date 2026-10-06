import type { ConvexClient } from 'convex/browser';
import type { FunctionReference } from 'convex/server';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { runIncrementalSubscribeLive } from './feed-runtime.js';
import type { IncrementalFeedDef, FeedPage } from './types.js';

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
          parsePage: (result) => result as FeedPage<TestItem>,
        },
        args: { id: 'machine-1' },
        buffer: { maxSize: 10, dedupe: true },
        subscribe: { limit: 10 },
        onItem: ({ item, ack }) =>
          Effect.sync(() => {
            handled.push(item.value);
            ack();
          }),
      })
    );
    let stopped = false;

    try {
      onUpdateCallback?.({
        items: [{ key: '001', value: 'first' }],
        highKey: '001',
        hasMore: false,
      });

      await vi.waitFor(() => expect(handled).toContain('first'));
      await Effect.runPromise(handle.stop());
      stopped = true;

      expect(wsClient.onUpdate).toHaveBeenCalled();
    } finally {
      if (!stopped) await Effect.runPromise(handle.stop());
    }
  });

  it('continues after a typed item failure and acknowledges successful delivery', async () => {
    let onUpdateCallback: ((result: unknown) => void) | undefined;
    const handled: string[] = [];
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
          buildArgs: (_args, afterKey, limit) => ({ afterKey: afterKey ?? undefined, limit }),
          parsePage: (result) => result as FeedPage<TestItem>,
        },
        args: { id: 'machine-1' },
        buffer: { maxSize: 10, dedupe: true },
        subscribe: { limit: 10 },
        onItem: ({ item, ack }) => {
          handled.push(item.key);
          if (item.key === '001') return Effect.fail(new Error('item failed'));
          return Effect.sync(ack);
        },
      })
    );

    try {
      onUpdateCallback?.({
        items: [
          { key: '001', value: 'failure' },
          { key: '002', value: 'success' },
        ],
        highKey: '002',
        hasMore: false,
      });
      await vi.waitFor(() => expect(handled).toEqual(['001', '002']));

      // The successful item's ack is observable through buffer deduplication.
      onUpdateCallback?.({
        items: [
          { key: '002', value: 'success' },
          { key: '003', value: 'after-duplicate' },
        ],
        highKey: '003',
        hasMore: false,
      });
      await vi.waitFor(() => expect(handled).toEqual(['001', '002', '003']));
    } finally {
      await Effect.runPromise(handle.stop());
    }
  });

  it('stop unsubscribes once, waits for an active handler finalizer, and prevents later work', async () => {
    let onUpdateCallback: ((result: unknown) => void) | undefined;
    const unsubscribes: ReturnType<typeof vi.fn>[] = [];
    const finalized: string[] = [];
    let stopped = false;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const wsClient = {
      onUpdate: vi.fn((_query, _args, onUpdate) => {
        onUpdateCallback = onUpdate;
        const unsubscribe = vi.fn();
        unsubscribes.push(unsubscribe);
        return unsubscribe;
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
          buildArgs: (_args, afterKey, limit) => ({ afterKey: afterKey ?? undefined, limit }),
          parsePage: (result) => result as FeedPage<TestItem>,
        },
        args: { id: 'machine-1' },
        buffer: { maxSize: 10, dedupe: true },
        subscribe: { limit: 10 },
        onItem: ({ item }) =>
          Effect.sync(signalStarted).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(Effect.sync(() => finalized.push(item.key)))
          ),
      })
    );

    try {
      onUpdateCallback?.({
        items: [{ key: '001', value: 'active' }],
        highKey: '001',
        hasMore: false,
      });
      await started;
      await Effect.runPromise(handle.stop());
      stopped = true;
      expect(finalized).toEqual(['001']);
      expect(unsubscribes).toHaveLength(2);
      expect(unsubscribes[0]).toHaveBeenCalledTimes(1);
      expect(unsubscribes[1]).toHaveBeenCalledTimes(1);
      onUpdateCallback?.({
        items: [{ key: '002', value: 'later' }],
        highKey: '002',
        hasMore: false,
      });
      await Effect.runPromise(Effect.sleep('20 millis'));
      expect(finalized).toEqual(['001']);
    } finally {
      if (!stopped) await Effect.runPromise(handle.stop());
    }
  });
});
