// fallow-ignore-file complexity
import type { DurableFifoQueueEntry, DurableFifoQueueStore } from './durable-fifo-queue-store.js';
import { reportOutboxFailure, type OutboxErrorLogger } from './outbox-failure.js';
import { computeExponentialRetryDelayMs } from './outbox-retry-backoff.js';

export type FifoSendOutcome<_TResult, TItem> = { kind: 'success' } | { kind: 'retry'; item: TItem };
export type FifoBatchedOutboxOptions<TItem, TResult> = {
  batchSize: number;
  send: (items: TItem[]) => Promise<TResult[]>;
  store: DurableFifoQueueStore;
  deliveryKey: string;
  serialize: (item: TItem) => string;
  /** Must throw for unsupported persisted payloads. */
  deserialize: (json: string) => TItem;
  retryDelayMs?: number | undefined;
  maxRetryDelayMs?: number | undefined;
  onError?: ((error: unknown) => void) | undefined;
  logger?: OutboxErrorLogger | undefined;
  isPermanentError?: ((error: unknown) => boolean) | undefined;
  classifyOutcome?: ((result: TResult, item: TItem) => FifoSendOutcome<TResult, TItem>) | undefined;
};
export type FifoBatchedOutbox<TItem, TResult> = {
  /** Resolves after local persistence, independently of delivery. */
  enqueue(item: TItem): Promise<void>;
  /** Explicit delivery barrier for consumers that need the server result. */
  enqueueAndWait(item: TItem): Promise<TResult>;
  /** Attempt pending deliveries now; background retries retain their backoff. */
  flushNow(): Promise<void>;
  /** Stop without waiting for the network; unsent rows remain durable. */
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
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retryAttempt = 0;
  let inFlightRows: DurableFifoQueueEntry[] = [];
  let enqueuedDuringDrain = false;
  // Retry a server-rejected batch individually to isolate a poison row.
  let isolateBatch = false;

  const schedule = (delay: number) => {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      void drain().catch(() => undefined);
    }, delay);
    timer.unref?.();
  };
  const scheduleRetry = () =>
    schedule(
      computeExponentialRetryDelayMs(
        retryAttempt++,
        o.retryDelayMs ?? 500,
        o.maxRetryDelayMs ?? 5000
      )
    );
  const quarantine = (row: DurableFifoQueueEntry, error: unknown) => {
    o.store.quarantine(row.id, error);
    waiters.get(row.id)?.reject(error);
    waiters.delete(row.id);
    reportOutboxFailure({
      operation: 'FIFO outbox delivery',
      deliveryKey: o.deliveryKey,
      error,
      disposition: 'quarantined',
      onError: o.onError,
      logger: o.logger,
    });
  };
  const drain = (): Promise<void> => {
    if (running) return running;
    // Assign running before work, including synchronous deserialization failures.
    running = Promise.resolve()
      .then(async () => {
        while (!stopped) {
          const claimed = o.store
            .claimNextBatch(o.deliveryKey, isolateBatch ? 1 : o.batchSize)
            .sort((a, b) => a.id - b.id);
          if (!claimed.length) {
            isolateBatch = false;
            break;
          }
          const rows: DurableFifoQueueEntry[] = [];
          const items: TItem[] = [];
          for (const row of claimed) {
            try {
              items.push(o.deserialize(row.payloadJson));
              rows.push(row);
            } catch (error) {
              quarantine(row, error);
            }
          }
          if (!rows.length) continue;
          inFlightRows = rows;
          let results: TResult[];
          try {
            results = await o.send(items);
          } catch (error) {
            inFlightRows = [];
            if (stopped) return;
            if (o.isPermanentError?.(error)) {
              if (rows.length === 1) quarantine(rows[0], error);
              else {
                for (const row of rows) o.store.markPending(row.id);
                isolateBatch = true;
              }
              continue;
            }
            for (const row of rows) o.store.markPendingRetry(row.id, error);
            reportOutboxFailure({
              operation: 'FIFO outbox delivery',
              deliveryKey: o.deliveryKey,
              error,
              disposition: 'retrying',
              onError: o.onError,
              logger: o.logger,
            });
            scheduleRetry();
            throw error;
          }
          inFlightRows = [];
          if (stopped) return;
          let hasRetry = false;
          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (i >= results.length) {
              o.store.markPending(row.id);
              hasRetry = true;
              continue;
            }
            const result = results[i];
            const outcome = o.classifyOutcome?.(result, items[i]) ?? { kind: 'success' as const };
            if (outcome.kind === 'retry') {
              o.store.updatePayload(row.id, o.serialize(outcome.item));
              o.store.markPending(row.id);
              hasRetry = true;
            } else {
              o.store.markDone(row.id);
              waiters.get(row.id)?.resolve(result);
              waiters.delete(row.id);
            }
          }
          if (hasRetry) {
            scheduleRetry();
            break;
          }
          retryAttempt = 0;
        }
      })
      .finally(() => {
        running = undefined;
        // A delivery waiter can enqueue in the microtask between the final claim
        // and this cleanup. It must not lose its wakeup; an existing retry timer wins.
        if (enqueuedDuringDrain) {
          enqueuedDuringDrain = false;
          schedule(0);
        }
      });
    return running;
  };
  const persist = (item: TItem): number => {
    if (stopped) throw new Error('Outbox is stopped');
    const payload = o.serialize(item);
    o.deserialize(payload);
    const id = o.store.enqueue(o.deliveryKey, payload);
    if (running) enqueuedDuringDrain = true;
    else schedule(0);
    return id;
  };
  const enqueue = async (item: TItem): Promise<void> => {
    persist(item);
  };
  const enqueueAndWait = (item: TItem): Promise<TResult> =>
    new Promise((resolve, reject) => {
      const id = persist(item);
      waiters.set(id, { resolve, reject });
    });
  const flushNow = async () => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = undefined;
    await drain();
  };
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    // A registry can recreate this key using the same open store before restart.
    for (const row of inFlightRows) o.store.markPending(row.id);
    inFlightRows = [];
    for (const waiter of waiters.values())
      waiter.reject(new Error('Outbox stopped before delivery'));
    waiters.clear();
    // Late completions check stopped before touching the (possibly closed) store.
  };
  if (o.store.listPendingForRecovery(o.deliveryKey).length) schedule(0);
  return { enqueue, enqueueAndWait, flushNow, stop };
}
