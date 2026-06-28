/**
 * Incremental sync feed — shared types for cursor-based daemon polling.
 *
 * See docs/design/incremental-sync-feed.md
 */

import type { Effect } from 'effect';

import type { MessageBuffer } from './message-buffer.js';

/** Opaque cursor carried across polls. Serialized to string for logs/persistence. */
export type StreamKey = string;

export interface PollPage<TItem> {
  readonly items: readonly TItem[];
  /** Greatest key in this page (used to advance cursor when items non-empty). */
  readonly highKey: StreamKey | null;
  readonly hasMore: boolean;
}

export interface PollRequest<TArgs> {
  readonly args: TArgs;
  readonly afterKey: StreamKey | null;
  readonly limit: number;
}

export interface IncrementalFeedDef<TItem, TArgs> {
  readonly name: string;
  /** Imperative poll — NOT a reactive subscription target. */
  readonly poll: (req: PollRequest<TArgs>) => Promise<PollPage<TItem>>;
  /** Stable identity for dedupe + FIFO ordering. */
  readonly itemKey: (item: TItem) => StreamKey;
  /** Optional: extract cursor from item when highKey not provided by backend. */
  readonly itemToKey?: (item: TItem) => StreamKey;
}

export type DeliveryMode = 'fifo' | 'standard';

export interface BufferConfig {
  /** Max items retained; oldest unacked dropped when exceeded. */
  readonly maxSize: number;
  /** fifo: single worker, strict key order. standard: parallel workers allowed. */
  readonly deliveryMode: DeliveryMode;
  /** Drop duplicate itemKey while still in buffer or recently acked (default: true). */
  readonly dedupe?: boolean;
  /** How long to suppress re-delivery after ack (ms). 0 = until removed from buffer only. */
  readonly dedupeTtlMs?: number;
  /** standard mode only: max concurrent handler invocations. */
  readonly maxConcurrency?: number;
}

export interface PollLoopConfig {
  readonly intervalMs: number;
  readonly limit: number;
  readonly backoff: { readonly initialMs: number; readonly maxMs: number };
}

export interface FeedHandlerContext<TItem> {
  readonly item: TItem;
  readonly feedName: string;
  /** Call when side effects are durably applied (removes from in-flight set). */
  readonly ack: () => void;
  readonly nack: (opts?: { requeue?: boolean }) => void;
}

export type FeedItemHandler<TItem, R = void> = (
  ctx: FeedHandlerContext<TItem>
) => Effect.Effect<R, unknown, never>;

export interface RunFeedOptions<TItem, TArgs> {
  readonly def: IncrementalFeedDef<TItem, TArgs>;
  readonly args: TArgs;
  readonly buffer: BufferConfig;
  readonly poll: PollLoopConfig;
  readonly onItem: FeedItemHandler<TItem>;
}

export interface FeedHandle<TItem> {
  readonly stop: () => Effect.Effect<void>;
  readonly buffer: MessageBuffer<TItem>;
}

export interface ReconcilePollOptions<TResult, TArgs> {
  readonly name: string;
  readonly poll: (args: TArgs) => Promise<TResult>;
  readonly args: TArgs;
  readonly intervalMs: number;
  readonly onResult: (result: TResult) => Effect.Effect<void, unknown, never>;
  readonly backoff?: { readonly initialMs: number; readonly maxMs: number };
}

export interface ReconcilePollHandle {
  readonly stop: () => Effect.Effect<void>;
}
