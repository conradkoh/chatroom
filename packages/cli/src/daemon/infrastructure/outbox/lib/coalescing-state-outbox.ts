// fallow-ignore-file complexity
import type { DurableCoalescingStateStore } from './durable-coalescing-state-store.js';
import { reportOutboxFailure, type OutboxErrorLogger } from './outbox-failure.js';
import { computeExponentialRetryDelayMs } from './outbox-retry-backoff.js';

export interface CoalescingStateOutboxOptions<TState, TResult> {
  minIntervalMs?: number | undefined;
  retryDelayMs?: number | undefined;
  maxRetryDelayMs?: number | undefined;
  send: (state: TState) => Promise<TResult>;
  onError?: ((error: unknown) => void) | undefined;
  logger?: OutboxErrorLogger | undefined;
  isPermanentError?: ((error: unknown) => boolean) | undefined;
  store?: DurableCoalescingStateStore | undefined;
  deliveryKey?: string | undefined;
  serialize?: ((state: TState) => string) | undefined;
  deserialize?: ((json: string) => TState) | undefined;
}

export interface CoalescingStateOutbox<TState, TResult> {
  /** Accept locally (persist first when configured), without waiting for delivery. */
  enqueue(state: TState): Promise<void>;
  /** Resolve when this state or a newer state is delivered. */
  enqueueAndWait(state: TState): Promise<TResult>;
  /** Attempt delivery now, rejecting on transient failure; background retry remains active. */
  flushNow(): Promise<void>;
  /** Stop scheduling, preserve durable state, and reject delivery waiters. */
  stop(): Promise<void>;
}

type Waiter<TResult> = { resolve: (result: TResult) => void; reject: (error: unknown) => void };
type PendingState<TState, TResult> = { state: TState; waiters: Waiter<TResult>[] };

/** Latest-state projection outbox; the caller owns the source of truth. */
export function createCoalescingStateOutbox<TState, TResult>(
  options: CoalescingStateOutboxOptions<TState, TResult>
): CoalescingStateOutbox<TState, TResult> {
  const durable = [options.store, options.deliveryKey, options.serialize, options.deserialize];
  if (durable.some(Boolean) && durable.some((value) => !value))
    throw new Error('Durable outbox requires store, deliveryKey, serialize, and deserialize');
  const store = options.store;
  const key = options.deliveryKey;
  const minIntervalMs = options.minIntervalMs ?? 5000;
  let pending: PendingState<TState, TResult> | null = null;
  let inFlight: PendingState<TState, TResult> | null = null;
  let running: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let lastSentAt = 0;
  let retryAttempt = 0;

  const report = (error: unknown, disposition: 'retrying' | 'quarantined') =>
    reportOutboxFailure({
      operation: 'coalescing outbox delivery',
      deliveryKey: key ?? '<memory>',
      error,
      disposition,
      onError: options.onError,
      logger: options.logger,
    });
  const rejectWaiters = (batch: PendingState<TState, TResult> | null, error: unknown) => {
    for (const waiter of batch?.waiters ?? []) waiter.reject(error);
  };
  const schedule = (delay: number) => {
    if (stopped || !pending || timer) return;
    timer = setTimeout(
      () => {
        timer = undefined;
        void drain().catch(() => undefined);
      },
      Math.max(0, delay)
    );
    timer.unref?.();
  };
  const drain = (): Promise<void> => {
    if (running) return running;
    if (stopped || !pending) return Promise.resolve();
    const batch = pending;
    pending = null;
    inFlight = batch;
    let delay = 0;
    running = Promise.resolve()
      .then(async () => {
        if (stopped) return;
        try {
          const result = await options.send(batch.state);
          if (stopped) return;
          lastSentAt = Date.now();
          retryAttempt = 0;
          // Enqueue already persisted a newer snapshot; never delete it on old completion.
          if (!pending && store && key) store.markDone(key);
          for (const waiter of batch.waiters) waiter.resolve(result);
          delay = minIntervalMs;
        } catch (error) {
          if (stopped) return;
          const newer = pending as PendingState<TState, TResult> | null;
          if (options.isPermanentError?.(error)) {
            if (store && key && options.serialize) {
              store.quarantine(key, options.serialize(batch.state), error);
              if (!newer) store.markDone(key);
            }
            rejectWaiters(batch, error);
            report(error, 'quarantined');
            retryAttempt = 0;
          } else {
            pending = {
              state: newer?.state ?? batch.state,
              waiters: [...batch.waiters, ...(newer?.waiters ?? [])],
            };
            if (store && key) store.markPendingRetry(key, error);
            delay = computeExponentialRetryDelayMs(
              retryAttempt++,
              options.retryDelayMs ?? 500,
              options.maxRetryDelayMs ?? 5000
            );
            report(error, 'retrying');
            throw error;
          }
        }
      })
      .finally(() => {
        running = undefined;
        inFlight = null;
        schedule(delay);
      });
    return running;
  };
  if (store && key && options.deserialize) {
    const recovered = store.getPending(key);
    if (recovered) {
      try {
        pending = { state: options.deserialize(recovered.payloadJson), waiters: [] };
        retryAttempt = recovered.attempts;
      } catch (error) {
        store.quarantine(key, recovered.payloadJson, error);
        store.markDone(key);
        report(error, 'quarantined');
      }
      schedule(
        retryAttempt > 0
          ? computeExponentialRetryDelayMs(
              retryAttempt - 1,
              options.retryDelayMs ?? 500,
              options.maxRetryDelayMs ?? 5000
            )
          : 0
      );
    }
  }

  const accept = (state: TState, waiter?: Waiter<TResult>) => {
    if (stopped) throw new Error('Outbox is stopped');
    if (store && key && options.serialize && options.deserialize) {
      const payload = options.serialize(state);
      options.deserialize(payload);
      store.upsertPending(key, payload);
    }
    pending = { state, waiters: [...(pending?.waiters ?? []), ...(waiter ? [waiter] : [])] };
    if (!running) schedule(lastSentAt === 0 ? 0 : minIntervalMs - (Date.now() - lastSentAt));
  };
  const enqueue = async (state: TState): Promise<void> => {
    accept(state);
  };
  const enqueueAndWait = (state: TState): Promise<TResult> =>
    new Promise((resolve, reject) => {
      accept(state, { resolve, reject });
    });
  const flushNow = async () => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (running) await running;
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (pending) await drain();
  };
  const stop = async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    const error = new Error('Outbox stopped before delivery');
    rejectWaiters(pending, error);
    rejectWaiters(inFlight, error);
    pending = null;
  };
  return { enqueue, enqueueAndWait, flushNow, stop };
}
