import type { FunctionReference } from 'convex/server';
import { describe, expect, it, vi } from 'vitest';

import { MessageBuffer } from './message-buffer.js';
import { startSubscribeLoop } from './subscribe-loop.js';
import type { IncrementalFeedDef, PollPage } from './types.js';

type TestItem = { key: string; value: string };

function makeDef(): IncrementalFeedDef<TestItem, { machineId: string }> {
  return {
    name: 'test-feed',
    itemKey: (item) => item.key,
  };
}

const testQuery = 'test.query' as unknown as FunctionReference<'query'>;

describe('startSubscribeLoop', () => {
  it('enqueues items and re-subscribes with advanced cursor', () => {
    const buffer = new MessageBuffer<TestItem>(
      { maxSize: 10, deliveryMode: 'fifo' },
      (item) => item.key
    );
    const buildArgsCalls: (string | null)[] = [];
    let onUpdateCallback: ((result: unknown) => void) | undefined;

    const wsClient = {
      onUpdate: vi.fn((_query, args, onUpdate, _onError) => {
        buildArgsCalls.push(args.afterKey ?? null);
        onUpdateCallback = onUpdate;
        return vi.fn();
      }),
    };

    startSubscribeLoop({
      wsClient: wsClient as never,
      target: {
        query: testQuery,
        buildArgs: (_args, afterKey, limit) => ({
          afterKey: afterKey ?? undefined,
          limit,
        }),
        parsePage: (result) => result as PollPage<TestItem>,
      },
      args: { machineId: 'm1' },
      buffer,
      def: makeDef(),
      config: { limit: 50 },
    });

    expect(buildArgsCalls).toEqual([null]);

    onUpdateCallback?.({
      items: [{ key: '001', value: 'a' }],
      highKey: '001',
      hasMore: false,
    });

    expect(buildArgsCalls).toEqual([null, '001']);
    expect(buffer.size()).toBe(1);
  });

  it('does not re-subscribe when page is empty', () => {
    const buffer = new MessageBuffer<TestItem>(
      { maxSize: 10, deliveryMode: 'fifo' },
      (item) => item.key
    );
    let onUpdateCallback: ((result: unknown) => void) | undefined;

    const wsClient = {
      onUpdate: vi.fn((_query, _args, onUpdate) => {
        onUpdateCallback = onUpdate;
        return vi.fn();
      }),
    };

    startSubscribeLoop({
      wsClient: wsClient as never,
      target: {
        query: testQuery,
        buildArgs: (_args, afterKey, limit) => ({
          afterKey: afterKey ?? undefined,
          limit,
        }),
        parsePage: (result) => result as PollPage<TestItem>,
      },
      args: { machineId: 'm1' },
      buffer,
      def: makeDef(),
      config: { limit: 50 },
    });

    onUpdateCallback?.({ items: [], highKey: null, hasMore: false });
    expect(wsClient.onUpdate).toHaveBeenCalledTimes(1);
  });
});
