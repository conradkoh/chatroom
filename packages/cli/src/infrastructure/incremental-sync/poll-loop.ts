/**
 * Poll loop — imperative cursor-based polling with backoff.
 */

import { Effect } from 'effect';

import { PollClock } from './layers.js';
import type { MessageBuffer } from './message-buffer.js';
import type { IncrementalFeedDef, PollLoopConfig, PollRequest, StreamKey } from './types.js';

// fallow-ignore-next-line complexity
function resolveHighKey<TItem>(
  def: IncrementalFeedDef<TItem, unknown>,
  buffer: MessageBuffer<TItem>,
  page: { items: readonly TItem[]; highKey: StreamKey | null }
): StreamKey | null {
  if (page.highKey !== null) return page.highKey;
  const fromItems = buffer.highKeyOf(page.items);
  if (fromItems !== null) return fromItems;
  if (def.itemToKey && page.items.length > 0) {
    let high: StreamKey | null = null;
    for (const item of page.items) {
      const key = def.itemToKey(item);
      if (high === null || key > high) high = key;
    }
    return high;
  }
  return null;
}

/**
 * Runs until interrupted. Drains all pages with hasMore before sleeping.
 */
// fallow-ignore-next-line complexity
export const makePollLoop = <TItem, TArgs>(
  def: IncrementalFeedDef<TItem, TArgs>,
  args: TArgs,
  buffer: MessageBuffer<TItem>,
  config: PollLoopConfig
): Effect.Effect<never, never, PollClock> =>
  Effect.gen(function* () {
    const clock = yield* PollClock;
    let afterKey: StreamKey | null = null;
    let backoffMs = config.intervalMs;

    while (true) {
      const pollOutcome = yield* Effect.either(
        // fallow-ignore-next-line complexity
        Effect.gen(function* () {
          let hasMore = true;

          while (hasMore) {
            const req: PollRequest<TArgs> = {
              args,
              afterKey,
              limit: config.limit,
            };
            const page = yield* Effect.tryPromise(() => def.poll(req));

            if (page.items.length > 0) {
              buffer.enqueue(page.items);
              const nextKey = resolveHighKey(
                def as IncrementalFeedDef<TItem, unknown>,
                buffer,
                page
              );
              if (nextKey !== null) {
                afterKey = nextKey;
              }
              backoffMs = config.intervalMs;
            }

            hasMore = page.hasMore;
            if (!hasMore && page.items.length === 0) {
              break;
            }
          }

          return true;
        })
      );

      if (pollOutcome._tag === 'Left') {
        backoffMs = Math.min(
          backoffMs === config.intervalMs ? config.backoff.initialMs : backoffMs * 2,
          config.backoff.maxMs
        );
      } else {
        backoffMs = config.intervalMs;
      }

      yield* clock.sleep(backoffMs);
    }
  });
