/**
 * Subscribe loop — cursor-pinned Convex WebSocket subscription for delta feeds.
 */

import type { ConvexClient } from 'convex/browser';

import type { MessageBuffer } from './message-buffer.js';
import { resolveHighKey } from './resolve-high-key.js';
import type {
  FeedPage,
  IncrementalFeedDef,
  StreamKey,
  SubscribeLoopConfig,
  SubscribeQueryTarget,
} from './types.js';

export interface SubscribeLoopHandle {
  readonly stop: () => void;
  readonly getAfterKey: () => StreamKey | null;
}

export function startSubscribeLoop<TItem, TArgs>(opts: {
  wsClient: ConvexClient;
  target: SubscribeQueryTarget<TItem, TArgs>;
  args: TArgs;
  buffer: MessageBuffer<TItem>;
  def: IncrementalFeedDef<TItem, TArgs>;
  config: SubscribeLoopConfig;
  initialAfterKey?: StreamKey | null;
  onError?: (err: unknown) => void;
}): SubscribeLoopHandle {
  let afterKey: StreamKey | null = opts.initialAfterKey ?? null;
  let stopped = false;
  let unsubscribe: (() => void) | undefined;
  let drainInFlight = false;

  const subscribe = (): void => {
    if (stopped) return;
    unsubscribe?.();
    unsubscribe = opts.wsClient.onUpdate(
      opts.target.query,
      opts.target.buildArgs(opts.args, afterKey, opts.config.limit),
      (result: unknown) => {
        if (stopped) return;
        const page = opts.target.parsePage(result);
        void drainPages(page);
      },
      (err: unknown) => {
        opts.onError?.(err);
      }
    );
  };

  const fetchPage = async (cursor: StreamKey | null): Promise<FeedPage<TItem>> => {
    const result = await opts.wsClient.query(
      opts.target.query,
      opts.target.buildArgs(opts.args, cursor, opts.config.limit)
    );
    return opts.target.parsePage(result);
  };

  // fallow-ignore-next-line complexity
  const drainPages = async (initialPage: FeedPage<TItem>): Promise<void> => {
    if (stopped || drainInFlight) return;
    drainInFlight = true;

    try {
      const cursorAtStart = afterKey;
      let page = initialPage;

      while (!stopped && page.items.length > 0) {
        opts.buffer.enqueue(page.items);
        const nextKey = resolveHighKey(
          opts.def as IncrementalFeedDef<TItem, unknown>,
          opts.buffer,
          page
        );
        if (nextKey === null) {
          break;
        }
        afterKey = nextKey;

        if (!page.hasMore) {
          break;
        }

        page = await fetchPage(afterKey);
      }

      if (!stopped && afterKey !== cursorAtStart) {
        subscribe();
      }
    } catch (err) {
      opts.onError?.(err);
    } finally {
      drainInFlight = false;
    }
  };

  subscribe();

  return {
    stop: () => {
      stopped = true;
      unsubscribe?.();
      unsubscribe = undefined;
    },
    getAfterKey: () => afterKey,
  };
}
