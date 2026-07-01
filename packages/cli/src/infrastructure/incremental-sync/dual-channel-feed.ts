/**
 * Dual-channel feed — wires incremental subscribe + reconcile poll over a working snapshot.
 */
// fallow-ignore-file unused-file

import type { ConvexClient } from 'convex/browser';
import { Effect } from 'effect';

import { runIncrementalSubscribeLive, runReconcilePollLive } from './feed-runtime.js';
import { resolveSnapshotRowForSignal } from './resolve-snapshot-row.js';
import type {
  BufferConfig,
  IncrementalFeedDef,
  StreamKey,
  SubscribeLoopConfig,
  SubscribeQueryTarget,
} from './types.js';

export interface DualChannelFeedSnapshot<TRow, TSignal> {
  replaceAll(rows: readonly TRow[]): void;
  mergeSignal(signal: TSignal): TRow | undefined;
  getBySignal(signal: TSignal): TRow | undefined;
}

export interface DualChannelFeedHandle {
  readonly stop: () => Effect.Effect<void>;
}

export interface RunDualChannelFeedOptions<TSignal, TRow, TArgs, TReconcileResult> {
  readonly name: string;
  readonly wsClient: ConvexClient;
  readonly def: IncrementalFeedDef<TSignal, TArgs>;
  readonly target: SubscribeQueryTarget<TSignal, TArgs>;
  readonly args: TArgs;
  readonly buffer: BufferConfig;
  readonly subscribe: SubscribeLoopConfig;
  readonly snapshot: DualChannelFeedSnapshot<TRow, TSignal>;
  readonly seedCursor: () => Promise<StreamKey | null>;
  readonly fetchReconcile: () => Promise<TReconcileResult>;
  readonly extractReconcileRows: (result: TReconcileResult) => readonly TRow[];
  readonly reconcileIntervalMs: number;
  readonly isStopped: () => boolean;
  readonly onSignalRow: (row: TRow) => Effect.Effect<void, unknown, never>;
  readonly onReconcileRows: (rows: readonly TRow[]) => Effect.Effect<void, unknown, never>;
  readonly onSubscribeError?: (err: unknown) => void;
}

export const runDualChannelFeedLive = <TSignal, TRow, TArgs, TReconcileResult>(
  opts: RunDualChannelFeedOptions<TSignal, TRow, TArgs, TReconcileResult>
): Effect.Effect<DualChannelFeedHandle, never, never> =>
  Effect.gen(function* () {
    const initial = yield* Effect.tryPromise(() => opts.fetchReconcile()).pipe(
      Effect.orElseSucceed(() => null)
    );
    if (initial !== null) {
      const rows = opts.extractReconcileRows(initial);
      opts.snapshot.replaceAll(rows);
      if (rows.length > 0) {
        yield* opts.onReconcileRows(rows).pipe(Effect.catchAll(() => Effect.void));
      }
    }

    const seedKey = yield* Effect.tryPromise(() => opts.seedCursor()).pipe(
      Effect.orElseSucceed(() => null)
    );

    const hydrateFromReconcile = async (): Promise<readonly TRow[]> =>
      opts.extractReconcileRows(await opts.fetchReconcile());

    const resolveRowForSignal = async (signal: TSignal): Promise<TRow | undefined> =>
      resolveSnapshotRowForSignal(opts.snapshot, signal, hydrateFromReconcile);

    const signalHandle = yield* runIncrementalSubscribeLive({
      wsClient: opts.wsClient,
      def: opts.def,
      target: opts.target,
      args: opts.args,
      buffer: opts.buffer,
      subscribe: opts.subscribe,
      initialAfterKey: seedKey,
      onError: opts.onSubscribeError,
      onItem: ({ item: signal, ack }) =>
        Effect.gen(function* () {
          ack();
          if (opts.isStopped()) {
            return;
          }
          const row = yield* Effect.tryPromise(() => resolveRowForSignal(signal));
          if (!row) {
            return;
          }
          yield* opts.onSignalRow(row).pipe(Effect.catchAll(() => Effect.void));
        }),
    });

    const reconcileHandle = yield* runReconcilePollLive({
      name: `${opts.name}-reconcile`,
      poll: () => opts.fetchReconcile(),
      args: undefined,
      intervalMs: opts.reconcileIntervalMs,
      onResult: (result) =>
        Effect.gen(function* () {
          const rows = opts.extractReconcileRows(result);
          opts.snapshot.replaceAll(rows);
          yield* opts.onReconcileRows(rows).pipe(Effect.catchAll(() => Effect.void));
        }),
    });

    return {
      stop: () =>
        Effect.gen(function* () {
          yield* signalHandle.stop();
          yield* reconcileHandle.stop();
        }),
    };
  });
