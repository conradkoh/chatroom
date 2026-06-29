/**
 * In-memory message buffer for incremental sync feeds.
 * FIFO delivery, dedupe, bounded size.
 */

import type { BufferConfig, StreamKey } from './types.js';

interface QueuedItem<TItem> {
  key: StreamKey;
  item: TItem;
}

export class MessageBuffer<TItem> {
  private readonly queue: QueuedItem<TItem>[] = [];
  private readonly inBuffer = new Set<StreamKey>();
  private readonly inFlight = new Map<StreamKey, TItem>();
  private readonly recentlyAcked = new Map<StreamKey, number>();
  private readonly dedupe: boolean;
  private readonly dedupeTtlMs: number;
  private readonly maxSize: number;

  constructor(
    config: BufferConfig,
    private readonly keyOf: (item: TItem) => StreamKey
  ) {
    this.dedupe = config.dedupe ?? true;
    this.dedupeTtlMs = config.dedupeTtlMs ?? 0;
    this.maxSize = config.maxSize;
  }

  // fallow-ignore-next-line complexity
  enqueue(items: readonly TItem[]): number {
    this.pruneRecentlyAcked();
    let enqueued = 0;

    for (const item of items) {
      const key = this.keyOf(item);
      if (this.dedupe && this.shouldSkip(key)) {
        continue;
      }

      this.queue.push({ key, item });
      this.inBuffer.add(key);
      enqueued++;
    }

    if (enqueued > 0) {
      this.queue.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    }

    this.enforceMaxSize();
    return enqueued;
  }

  dequeue(): TItem | undefined {
    this.pruneRecentlyAcked();
    const next = this.queue.shift();
    if (!next) return undefined;

    this.inBuffer.delete(next.key);
    this.inFlight.set(next.key, next.item);
    return next.item;
  }

  ack(key: StreamKey): void {
    this.inFlight.delete(key);
    if (this.dedupe) {
      this.recentlyAcked.set(key, Date.now());
    }
  }

  nack(key: StreamKey, requeue = false): void {
    const item = this.inFlight.get(key);
    this.inFlight.delete(key);
    if (requeue && item !== undefined) {
      this.enqueue([item]);
    }
  }

  // fallow-ignore-next-line unused-class-member
  size(): number {
    return this.queue.length;
  }

  // fallow-ignore-next-line complexity
  highKeyOf(items: readonly TItem[]): StreamKey | null {
    if (items.length === 0) return null;
    let high: StreamKey | null = null;
    for (const item of items) {
      const key = this.keyOf(item);
      if (high === null || key > high) {
        high = key;
      }
    }
    return high;
  }

  // fallow-ignore-next-line complexity
  private shouldSkip(key: StreamKey): boolean {
    if (this.inBuffer.has(key) || this.inFlight.has(key)) {
      return true;
    }
    if (this.dedupeTtlMs > 0) {
      const ackedAt = this.recentlyAcked.get(key);
      if (ackedAt !== undefined && Date.now() - ackedAt < this.dedupeTtlMs) {
        return true;
      }
    } else if (this.recentlyAcked.has(key)) {
      return true;
    }
    return false;
  }

  private pruneRecentlyAcked(): void {
    if (this.dedupeTtlMs <= 0) return;
    const now = Date.now();
    for (const [key, ackedAt] of this.recentlyAcked) {
      if (now - ackedAt >= this.dedupeTtlMs) {
        this.recentlyAcked.delete(key);
      }
    }
  }

  private enforceMaxSize(): void {
    while (this.queue.length > this.maxSize) {
      const dropped = this.queue.shift();
      if (dropped) {
        this.inBuffer.delete(dropped.key);
        console.warn(
          `[incremental-sync] Buffer full — dropped oldest unacked item (key=${dropped.key})`
        );
      }
    }
  }
}
