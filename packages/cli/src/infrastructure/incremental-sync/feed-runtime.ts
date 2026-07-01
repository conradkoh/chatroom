/**
 * Feed runtime — wires subscribe loop, buffer, item handlers, and dual-channel orchestration.
 */

import type { ConvexClient } from 'convex/browser';
import { Effect, Fiber } from 'effect';

import { IntervalClock, IntervalClockLive } from './layers.js';
import { MessageBuffer } from './message-buffer.js';
import { resolveSnapshotRowForSignal } from './resolve-snapshot-row.js';
import { startSubscribeLoop } from './subscribe-loop.js';
import type {
  BufferConfig,
  FeedHandle,
  FeedHandlerContext,
  FeedItemHandler,
  IncrementalFeedDef,
  ReconcilePollHandle,
  ReconcilePollOptions,
  RunSubscribeFeedOptions,
  StreamKey,
  SubscribeLoopConfig,
  SubscribeQueryTarget,
} from './types.js';

function runWorkerLoop<TItem>(
  feedName: string,
  buffer: MessageBuffer<TItem>,
  keyOf: (item: TItem) => StreamKey,
  onItem: FeedItemHandler<TItem>
): Effect.Effect<never, never, never> {
  return Effect.gen(function* () {
    while (true) {
      const item = buffer.dequeue();
      if (item === undefined) {
        yield* Effect.sleep('10 millis');
        continue;
      }

      const key = keyOf(item);
      const ctx: FeedHandlerContext<TItem> = {
        item,
        feedName,
        ack: () => buffer.ack(key),
        nack: (opts) => buffer.nack(key, opts?.requeue ?? false),
      };

      yield* onItem(ctx).pipe(Effect.catchAll(() => Effect.void));
    }
  });
}

export const runIncrementalSubscribeLive = <TItem, TArgs>(
  opts: RunSubscribeFeedOptions<TItem, TArgs>
): Effect.Effect<FeedHandle<TItem>, never, never> =>
  Effect.gen(function* () {
    const buffer = new MessageBuffer(opts.buffer, opts.def.itemKey);
    const subscribeHandle = startSubscribeLoop({
      wsClient: opts.wsClient,
      target: opts.target,
      args: opts.args,
      buffer,
      def: opts.def,
      config: opts.subscribe,
      initialAfterKey: opts.initialAfterKey ?? null,
      onError: opts.onError,
    });
    const workerFiber = yield* Effect.forkDaemon(
      runWorkerLoop(opts.def.name, buffer, opts.def.itemKey, opts.onItem)
    );

    return {
      buffer,
      stop: () =>
        Effect.gen(function* () {
          subscribeHandle.stop();
          yield* Fiber.interrupt(workerFiber);
        }),
    };
  });

/**
 * Fixed-interval imperative poll without buffering — for full snapshot reconcile loops.
 */
const runReconcilePoll = <TResult, TArgs>(
  opts: ReconcilePollOptions<TResult, TArgs>
): Effect.Effect<ReconcilePollHandle, never, IntervalClock> =>
  Effect.gen(function* () {
    const clock = yield* IntervalClock;
    const backoffCfg = opts.backoff ?? { initialMs: 1_000, maxMs: 30_000 };
    let backoffMs = opts.intervalMs;
    let stopped = false;

    const loopFiber = yield* Effect.forkDaemon(
      Effect.gen(function* () {
        while (!stopped) {
          const pollOutcome = yield* Effect.either(Effect.tryPromise(() => opts.poll(opts.args)));

          if (pollOutcome._tag === 'Left') {
            backoffMs = Math.min(
              backoffMs === opts.intervalMs ? backoffCfg.initialMs : backoffMs * 2,
              backoffCfg.maxMs
            );
            yield* clock.sleep(backoffMs);
            continue;
          }

          yield* opts.onResult(pollOutcome.right);
          backoffMs = opts.intervalMs;
          yield* clock.sleep(opts.intervalMs);
        }
      })
    );

    return {
      stop: () =>
        Effect.gen(function* () {
          stopped = true;
          yield* Fiber.interrupt(loopFiber);
        }),
    };
  });

const runReconcilePollLive = <TResult, TArgs>(
  opts: ReconcilePollOptions<TResult, TArgs>
): Effect.Effect<ReconcilePollHandle, never, never> =>
  runReconcilePoll(opts).pipe(Effect.provide(IntervalClockLive));

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
  /** Omit to skip the reconcile poll (signal-only feeds, e.g. task-monitor + presence channel). */
  readonly reconcileIntervalMs?: number;
  readonly isStopped: () => boolean;
  readonly onSignalRow: (row: TRow) => Effect.Effect<void, unknown, never>;
  readonly onReconcileRows: (rows: readonly TRow[]) => Effect.Effect<void, unknown, never>;
  readonly onSubscribeError?: (err: unknown) => void;
}

/** Hydrate, cursor seed, incremental subscribe, and reconcile poll over a working snapshot. */
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

    const reconcileHandle =
      opts.reconcileIntervalMs === undefined
        ? null
        : yield* runReconcilePollLive({
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
          if (reconcileHandle !== null) {
            yield* reconcileHandle.stop();
          }
        }),
    };
  });
