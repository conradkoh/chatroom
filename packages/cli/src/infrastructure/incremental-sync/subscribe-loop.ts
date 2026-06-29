/**
 * Subscribe loop — cursor-pinned Convex WebSocket subscription for delta feeds.
 */

import type { ConvexClient } from 'convex/browser';

import type { MessageBuffer } from './message-buffer.js';
import { resolveHighKey } from './resolve-high-key.js';
import type {
  IncrementalFeedDef,
  PollPage,
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

  const subscribe = (): void => {
    if (stopped) return;
    unsubscribe?.();
    unsubscribe = opts.wsClient.onUpdate(
      opts.target.query,
      opts.target.buildArgs(opts.args, afterKey, opts.config.limit),
      (result: unknown) => {
        if (stopped) return;
        const page = opts.target.parsePage(result);
        applyPage(page);
      },
      (err: unknown) => {
        opts.onError?.(err);
      }
    );
  };

  const applyPage = (page: PollPage<TItem>): void => {
    if (page.items.length === 0) return;

    opts.buffer.enqueue(page.items);
    const nextKey = resolveHighKey(
      opts.def as IncrementalFeedDef<TItem, unknown>,
      opts.buffer,
      page
    );
    if (nextKey !== null && nextKey !== afterKey) {
      afterKey = nextKey;
      subscribe();
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
