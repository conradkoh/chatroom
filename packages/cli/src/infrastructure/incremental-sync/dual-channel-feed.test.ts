import type { ConvexClient } from 'convex/browser';
import type { FunctionReference } from 'convex/server';
import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  afterEach(() => {
    vi.useRealTimers();
  });

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

    try {
      expect(reconcileRows).toHaveLength(1);
      expect(reconcileRows[0]?.[0]?.heartbeatAt).toBe(1);

      onUpdateCallback?.({
        items: [{ id: 'a', status: 'closed' }],
        highKey: 'a',
        hasMore: false,
      });

      await vi.waitFor(() => expect(signalRows).toHaveLength(1));
      expect(signalRows[0]?.status).toBe('closed');

      await vi.waitFor(() => expect(reconcilePollCount).toBeGreaterThanOrEqual(2));
    } finally {
      stopped = true;
      await Effect.runPromise(handle.stop());
    }
  });

  it('backs off after failures, caps delays, and resets to the interval after success', async () => {
    vi.useFakeTimers();
    const callTimes: number[] = [];
    const startTime = Date.now();
    const reconcileRows: Row[][] = [];
    let stopped = false;
    let call = 0;
    const wsClient = {
      onUpdate: vi.fn(() => {
        return vi.fn();
      }),
    } as unknown as ConvexClient;
    const def: IncrementalFeedDef<Signal, { id: string }> = {
      name: 'test-feed',
      itemKey: (item) => item.id,
    };
    const handle = await Effect.runPromise(
      runDualChannelFeedLive({
        name: 'test-feed',
        wsClient,
        def,
        target: {
          query: testQuery,
          buildArgs: (_args, afterKey, limit) => ({ afterKey: afterKey ?? undefined, limit }),
          parsePage: (result) => result as FeedPage<Signal>,
        },
        args: { id: 'machine-1' },
        buffer: { maxSize: 10, dedupe: true },
        subscribe: { limit: 10 },
        snapshot: createSnapshot(),
        seedCursor: async () => 'seed',
        fetchReconcile: async () => {
          callTimes.push(Date.now() - startTime);
          call++;
          if (call >= 2 && call <= 7) throw new Error('temporary reconcile failure');
          return { rows: [{ id: 'a', status: 'open', heartbeatAt: call }] };
        },
        extractReconcileRows: (result) => result.rows,
        reconcileIntervalMs: 10,
        isStopped: () => stopped,
        onSignalRow: () => Effect.void,
        onReconcileRows: (rows) => Effect.sync(() => reconcileRows.push([...rows])),
      })
    );

    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(callTimes).toEqual([0, 0]);
      const expectedCalls = [
        { at: 1_000, count: 3 },
        { at: 3_000, count: 4 },
        { at: 7_000, count: 5 },
        { at: 15_000, count: 6 },
        { at: 31_000, count: 7 },
        { at: 61_000, count: 8 },
        { at: 61_010, count: 9 },
      ];
      for (const expected of expectedCalls) {
        await vi.advanceTimersByTimeAsync(expected.at - (Date.now() - startTime));
        expect(callTimes).toHaveLength(expected.count);
        expect(callTimes.at(-1)).toBe(expected.at);
      }
      expect(reconcileRows.map((rows) => rows[0]?.heartbeatAt)).toEqual([1, 8, 9]);
    } finally {
      stopped = true;
      await Effect.runPromise(handle.stop());
    }
  });

  it('signal-only feed hydrates once and does not poll reconciliation', async () => {
    vi.useFakeTimers();
    let fetchCount = 0;
    let stopped = false;
    const wsClient = {
      onUpdate: vi.fn(() => vi.fn()),
    } as unknown as ConvexClient;
    const handle = await Effect.runPromise(
      runDualChannelFeedLive({
        name: 'signal-only',
        wsClient,
        def: { name: 'signal-only', itemKey: (item: Signal) => item.id },
        target: {
          query: testQuery,
          buildArgs: (_args, afterKey, limit) => ({ afterKey: afterKey ?? undefined, limit }),
          parsePage: (result) => result as FeedPage<Signal>,
        },
        args: { id: 'machine-1' },
        buffer: { maxSize: 10, dedupe: true },
        subscribe: { limit: 10 },
        snapshot: createSnapshot(),
        seedCursor: async () => 'seed',
        fetchReconcile: async () => {
          fetchCount++;
          return { rows: [] as Row[] };
        },
        extractReconcileRows: (result) => result.rows,
        isStopped: () => stopped,
        onSignalRow: () => Effect.void,
        onReconcileRows: () => Effect.void,
      })
    );

    try {
      expect(fetchCount).toBe(1);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(fetchCount).toBe(1);
    } finally {
      stopped = true;
      await Effect.runPromise(handle.stop());
    }
  });

  it('does not handle a reconcile result that resolves after stop', async () => {
    let resolvePoll!: (value: { rows: Row[] }) => void;
    let pollStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      pollStarted = resolve;
    });
    let fetchCount = 0;
    let stopped = false;
    const reconcileRows: Row[][] = [];
    const wsClient = {
      onUpdate: vi.fn(() => vi.fn()),
    } as unknown as ConvexClient;
    const handle = await Effect.runPromise(
      runDualChannelFeedLive({
        name: 'late-poll',
        wsClient,
        def: { name: 'late-poll', itemKey: (item: Signal) => item.id },
        target: {
          query: testQuery,
          buildArgs: (_args, afterKey, limit) => ({ afterKey: afterKey ?? undefined, limit }),
          parsePage: (result) => result as FeedPage<Signal>,
        },
        args: { id: 'machine-1' },
        buffer: { maxSize: 10, dedupe: true },
        subscribe: { limit: 10 },
        snapshot: createSnapshot(),
        seedCursor: async () => 'seed',
        fetchReconcile: async () => {
          fetchCount++;
          if (fetchCount === 1) return { rows: [] as Row[] };
          pollStarted();
          return new Promise<{ rows: Row[] }>((resolve) => {
            resolvePoll = resolve;
          });
        },
        extractReconcileRows: (result) => result.rows,
        reconcileIntervalMs: 1,
        isStopped: () => stopped,
        onSignalRow: () => Effect.void,
        onReconcileRows: (rows) => Effect.sync(() => reconcileRows.push([...rows])),
      })
    );

    try {
      await started;
      stopped = true;
      await Effect.runPromise(handle.stop());
      resolvePoll({ rows: [{ id: 'late', status: 'open', heartbeatAt: 2 }] });
      await Promise.resolve();
      expect(reconcileRows).toEqual([]);
    } finally {
      stopped = true;
      resolvePoll?.({ rows: [] });
      await Effect.runPromise(handle.stop());
    }
  });
});
