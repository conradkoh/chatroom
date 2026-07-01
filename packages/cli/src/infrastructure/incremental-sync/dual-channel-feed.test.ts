import type { ConvexClient } from 'convex/browser';
import type { FunctionReference } from 'convex/server';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { runDualChannelFeedLive } from './feed-runtime.js';
import type { DualChannelFeedSnapshot } from './feed-runtime.js';
import type { IncrementalFeedDef, FeedPage } from './types.js';
import { WorkingSnapshot } from './working-snapshot.js';

type Signal = { id: string; status: string };
type Row = { id: string; status: string; heartbeatAt: number };

const testQuery = 'test.query' as unknown as FunctionReference<'query'>;

function createSnapshot(): DualChannelFeedSnapshot<Row, Signal> {
  return new WorkingSnapshot({
    rowKey: (row) => row.id,
    signalKey: (signal) => signal.id,
    mergeSignal: (existing, signal) => {
      if (!existing) {
        return undefined;
      }
      return { ...existing, status: signal.status };
    },
  });
}

describe('runDualChannelFeedLive', () => {
  it('hydrates, handles signals with cold hydrate, and reconciles on interval', async () => {
    const signalRows: Row[] = [];
    const reconcileRows: Row[][] = [];
    let onUpdateCallback: ((result: unknown) => void) | undefined;
    let reconcilePollCount = 0;
    let stopped = false;

    const wsClient = {
      onUpdate: vi.fn((_query, _args, onUpdate) => {
        onUpdateCallback = onUpdate;
        return vi.fn();
      }),
    } as unknown as ConvexClient;

    const def: IncrementalFeedDef<Signal, { id: string }> = {
      name: 'test-feed',
      itemKey: (item) => item.id,
    };

    const snapshot = createSnapshot();

    const handle = await Effect.runPromise(
      runDualChannelFeedLive({
        name: 'test-feed',
        wsClient,
        def,
        target: {
          query: testQuery,
          buildArgs: (_args, afterKey, limit) => ({
            afterKey: afterKey ?? undefined,
            limit,
          }),
          parsePage: (result) => result as FeedPage<Signal>,
        },
        args: { id: 'machine-1' },
        buffer: { maxSize: 10, dedupe: true },
        subscribe: { limit: 10 },
        snapshot,
        seedCursor: async () => 'seed',
        fetchReconcile: async () => {
          reconcilePollCount++;
          return {
            rows: [{ id: 'a', status: 'open', heartbeatAt: reconcilePollCount }],
          };
        },
        extractReconcileRows: (result) => result.rows,
        reconcileIntervalMs: 15,
        isStopped: () => stopped,
        onSignalRow: (row) =>
          Effect.sync(() => {
            signalRows.push(row);
          }),
        onReconcileRows: (rows) =>
          Effect.sync(() => {
            reconcileRows.push([...rows]);
          }),
      })
    );

    expect(reconcileRows).toHaveLength(1);
    expect(reconcileRows[0]?.[0]?.heartbeatAt).toBe(1);

    onUpdateCallback?.({
      items: [{ id: 'a', status: 'closed' }],
      highKey: 'a',
      hasMore: false,
    });

    await Effect.runPromise(Effect.sleep('80 millis'));
    expect(signalRows).toHaveLength(1);
    expect(signalRows[0]?.status).toBe('closed');

    await Effect.runPromise(Effect.sleep('40 millis'));
    expect(reconcilePollCount).toBeGreaterThanOrEqual(2);

    stopped = true;
    await Effect.runPromise(handle.stop());
  });
});
