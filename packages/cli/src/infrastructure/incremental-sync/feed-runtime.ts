/**
 * Feed runtime — wires poll loop, buffer, and item handlers.
 */

import { Effect, Fiber } from 'effect';

import { PollClock, PollClockLive } from './layers.js';
import { MessageBuffer } from './message-buffer.js';
import { makePollLoop } from './poll-loop.js';
import type {
  FeedHandle,
  FeedHandlerContext,
  FeedItemHandler,
  ReconcilePollHandle,
  ReconcilePollOptions,
  RunFeedOptions,
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

const runIncrementalFeed = <TItem, TArgs>(
  opts: RunFeedOptions<TItem, TArgs>
): Effect.Effect<FeedHandle<TItem>, never, PollClock> =>
  Effect.gen(function* () {
    const buffer = new MessageBuffer(opts.buffer, opts.def.itemKey);
    const pollFiber = yield* Effect.forkDaemon(
      makePollLoop(opts.def, opts.args, buffer, opts.poll)
    );
    const workerFiber = yield* Effect.forkDaemon(
      runWorkerLoop(opts.def.name, buffer, opts.def.itemKey, opts.onItem)
    );

    return {
      buffer,
      stop: () =>
        Effect.gen(function* () {
          yield* Fiber.interrupt(pollFiber);
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

/** Convenience: run feed with live clock when no PollClock in context. */
export const runIncrementalFeedLive = <TItem, TArgs>(
  opts: RunFeedOptions<TItem, TArgs>
): Effect.Effect<FeedHandle<TItem>, never, never> =>
  runIncrementalFeed(opts).pipe(Effect.provide(PollClockLive));

export const runReconcilePollLive = <TResult, TArgs>(
  opts: ReconcilePollOptions<TResult, TArgs>
): Effect.Effect<ReconcilePollHandle, never, never> =>
  runReconcilePoll(opts).pipe(Effect.provide(PollClockLive));
