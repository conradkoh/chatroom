/**
 * Feed runtime — wires subscribe loop, buffer, and item handlers.
 */

import { Effect, Fiber } from 'effect';

import { PollClock, PollClockLive } from './layers.js';
import { MessageBuffer } from './message-buffer.js';
import { startSubscribeLoop } from './subscribe-loop.js';
import type {
  FeedHandle,
  FeedHandlerContext,
  FeedItemHandler,
  ReconcilePollHandle,
  ReconcilePollOptions,
  RunSubscribeFeedOptions,
  StreamKey,
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
): Effect.Effect<ReconcilePollHandle, never, PollClock> =>
  Effect.gen(function* () {
    const clock = yield* PollClock;
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

export const runReconcilePollLive = <TResult, TArgs>(
  opts: ReconcilePollOptions<TResult, TArgs>
): Effect.Effect<ReconcilePollHandle, never, never> =>
  runReconcilePoll(opts).pipe(Effect.provide(PollClockLive));
