import { createFifoBatchedOutbox, type FifoBatchedOutbox } from './fifo-batched-outbox.js';
import {
  openDurableFifoQueueStore,
  type DurableFifoQueueStore,
} from './durable-fifo-queue-store.js';
export type KeyedFifoBatchedOutboxRegistry<TItem, TResult> = {
  enqueue(key: string, item: TItem): Promise<TResult>;
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
  onError?: (key: string, e: unknown) => void;
}): KeyedFifoBatchedOutboxRegistry<TItem, TResult> {
  const boxes = new Map<string, FifoBatchedOutbox<TItem, TResult>>();
  const get = (key: string) => {
    let b = boxes.get(key);
    if (!b) {
      b = createFifoBatchedOutbox({
        batchSize: o.batchSize,
        send: o.createSend(key),
        store: o.store,
        deliveryKey: key,
        serialize: o.serialize,
        deserialize: o.deserialize,
        onError: (e) => o.onError?.(key, e),
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
  return {
    enqueue: (k, i) => get(k).enqueue(i),
    flushNow: async (k) => {
      if (k) await get(k).flushNow();
      else for (const b of boxes.values()) await b.flushNow();
    },
    stop,
    stopAll: async () => {
      for (const k of [...boxes.keys()]) await stop(k);
      o.store.close();
    },
  };
}
export { openDurableFifoQueueStore };
