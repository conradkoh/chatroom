import type { DurableFifoQueueStore } from './durable-fifo-queue-store.js';
import {
  createFifoBatchedOutbox,
  type FifoBatchedOutbox,
  type FifoSendOutcome,
} from './fifo-batched-outbox.js';
import type { OutboxErrorLogger } from './outbox-failure.js';

export type KeyedFifoBatchedOutboxRegistry<TItem, TResult> = {
  enqueue(key: string, item: TItem): Promise<void>;
  enqueueAndWait(key: string, item: TItem): Promise<TResult>;
  flushNow(key?: string): Promise<void>;
  stop(key: string): Promise<void>;
  stopAll(): Promise<void>;
};
export function createKeyedFifoBatchedOutboxRegistry<TItem, TResult>(o: {
  store: DurableFifoQueueStore;
  batchSize: number;
  createSend: (key: string) => (items: TItem[]) => Promise<TResult[]>;
  serialize: (i: TItem) => string;
  deserialize: (s: string) => TItem;
  retryDelayMs?: number | undefined;
  maxRetryDelayMs?: number | undefined;
  onError?: ((key: string, e: unknown) => void) | undefined;
  logger?: OutboxErrorLogger | undefined;
  isPermanentError?: ((error: unknown) => boolean) | undefined;
  classifyOutcome?: ((result: TResult, item: TItem) => FifoSendOutcome<TResult, TItem>) | undefined;
}): KeyedFifoBatchedOutboxRegistry<TItem, TResult> {
  const boxes = new Map<string, FifoBatchedOutbox<TItem, TResult>>();
  let stopped = false;
  const get = (key: string) => {
    if (stopped) throw new Error('Outbox registry is stopped');
    let b = boxes.get(key);
    if (!b) {
      b = createFifoBatchedOutbox({
        batchSize: o.batchSize,
        send: o.createSend(key),
        store: o.store,
        deliveryKey: key,
        serialize: o.serialize,
        deserialize: o.deserialize,
        retryDelayMs: o.retryDelayMs,
        maxRetryDelayMs: o.maxRetryDelayMs,
        onError: (e) => o.onError?.(key, e),
        logger: o.logger,
        isPermanentError: o.isPermanentError,
        classifyOutcome: o.classifyOutcome,
      });
      boxes.set(key, b);
    }
    return b;
  };
  const stop = async (k: string) => {
    const b = boxes.get(k);
    if (b) {
      await b.stop();
      boxes.delete(k);
    }
  };
  // Replay all durable keys, even when no new command arrives for that agent.
  for (const key of o.store.listPendingKeys()) get(key);
  return {
    enqueue: async (k, i) => get(k).enqueue(i),
    enqueueAndWait: async (k, i) => get(k).enqueueAndWait(i),
    flushNow: async (k) => {
      if (k) await get(k).flushNow();
      else await Promise.all([...boxes.values()].map((box) => box.flushNow()));
    },
    stop,
    stopAll: async () => {
      if (stopped) return;
      stopped = true;
      for (const k of [...boxes.keys()]) await stop(k);
      o.store.close();
    },
  };
}
