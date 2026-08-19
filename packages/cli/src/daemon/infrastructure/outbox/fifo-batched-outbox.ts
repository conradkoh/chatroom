import type { DurableFifoQueueStore } from './durable-fifo-queue-store.js';
export type FifoBatchedOutboxOptions<TItem, TResult> = {
  batchSize: number;
  send: (items: TItem[]) => Promise<TResult[]>;
  store: DurableFifoQueueStore;
  deliveryKey: string;
  serialize: (item: TItem) => string;
  deserialize: (json: string) => TItem;
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
  onError?: (error: unknown) => void;
};
export type FifoBatchedOutbox<TItem, TResult> = {
  enqueue(item: TItem): Promise<TResult>;
  flushNow(): Promise<void>;
  stop(): Promise<void>;
};
export function createFifoBatchedOutbox<TItem, TResult>(
  o: FifoBatchedOutboxOptions<TItem, TResult>
): FifoBatchedOutbox<TItem, TResult> {
  const waiters = new Map<
    number,
    { resolve: (v: TResult) => void; reject: (e: unknown) => void }
  >();
  let running: Promise<void> | undefined;
  let stopped = false;
  const drain = async () => {
    if (running) return running;
    running = (async () => {
      while (true) {
        const rows = o.store.claimNextBatch(o.deliveryKey, o.batchSize);
        if (!rows.length) break;
        try {
          const results = await o.send(rows.map((r) => o.deserialize(r.payloadJson)));
          for (let i = 0; i < results.length; i++) {
            o.store.markDone(rows[i].id);
            waiters.get(rows[i].id)?.resolve(results[i]);
            waiters.delete(rows[i].id);
          }
          for (let i = results.length; i < rows.length; i++) o.store.markPending(rows[i].id);
        } catch (e) {
          o.onError?.(e);
          for (const r of rows) o.store.markPendingRetry(r.id, e);
          throw e;
        }
      }
    })().finally(() => {
      running = undefined;
    });
    return running;
  };
  const enqueue = (item: TItem) => {
    if (stopped) return Promise.reject(new Error('Outbox is stopped'));
    const id = o.store.enqueue(o.deliveryKey, o.serialize(item));
    const p = new Promise<TResult>((resolve, reject) => waiters.set(id, { resolve, reject }));
    void drain().catch(() => undefined);
    return p;
  };
  const flushNow = async () => {
    while (o.store.listPendingForRecovery(o.deliveryKey).length) {
      await drain();
    }
  };
  const stop = async () => {
    if (stopped) return;
    await flushNow();
    stopped = true;
  };
  return { enqueue, flushNow, stop };
}
