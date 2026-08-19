export interface CoalescingStateOutboxOptions<TState, TResult> {
  /** Minimum time between successful sends. The first send is immediate. */
  minIntervalMs?: number;
  /** Delay before retrying a failed send. */
  retryDelayMs?: number;
  /** Maximum retry delay after repeated failures. */
  maxRetryDelayMs?: number;
  send: (state: TState) => Promise<TResult>;
  onError?: (error: unknown) => void;
}

export interface CoalescingStateOutbox<TState, TResult> {
  /** Replace the pending state and resolve when that state or a newer state is sent. */
  enqueue(state: TState): Promise<TResult>;
  /** Attempt to send pending state immediately, ignoring the rate limit once. */
  flushNow(): Promise<void>;
  /** Stop scheduling and reject state that has not been sent. */
  stop(): Promise<void>;
}

type Waiter<TResult> = {
  resolve: (result: TResult) => void;
  reject: (error: unknown) => void;
};

type PendingState<TState, TResult> = {
  state: TState;
  waiters: Waiter<TResult>[];
};

type InFlightState<TState, TResult> = PendingState<TState, TResult> & {
  promise: Promise<TResult>;
};

const DEFAULT_MIN_INTERVAL_MS = 5_000;
const DEFAULT_RETRY_DELAY_MS = 500;
const DEFAULT_MAX_RETRY_DELAY_MS = 5_000;

/**
 * Coalescing outbox for outbound state projections.
 *
 * This is intentionally not FIFO: a newer state supersedes an older pending
 * state. The caller remains responsible for persisting the source of truth.
 * Failed sends retain the newest state and retry with backoff.
 */
export function createCoalescingStateOutbox<TState, TResult>(
  options: CoalescingStateOutboxOptions<TState, TResult>
): CoalescingStateOutbox<TState, TResult> {
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const maxRetryDelayMs = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;

  let pending: PendingState<TState, TResult> | null = null;
  let inFlight: InFlightState<TState, TResult> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSentAt = 0;
  let retryAttempt = 0;
  let stopped = false;

  const rejectWaiters = (waiters: Waiter<TResult>[], error: unknown): void => {
    for (const waiter of waiters) waiter.reject(error);
  };

  const mergePending = (
    older: PendingState<TState, TResult>,
    newer: PendingState<TState, TResult> | null
  ): PendingState<TState, TResult> => ({
    state: newer?.state ?? older.state,
    waiters: [...older.waiters, ...(newer?.waiters ?? [])],
  });

  const clearTimer = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const schedule = (delayMs: number): void => {
    if (stopped || !pending || inFlight || timer) return;
    timer = setTimeout(
      () => {
        timer = null;
        void drain().catch(() => undefined);
      },
      Math.max(0, delayMs)
    );
    timer.unref?.();
  };

  async function drain(): Promise<void> {
    if (stopped || !pending || inFlight) return;

    const batch = pending;
    pending = null;
    const sendPromise = Promise.resolve().then(() => options.send(batch.state));
    inFlight = { ...batch, promise: sendPromise };

    let retryDelay: number | null = null;
    try {
      const result = await sendPromise;
      lastSentAt = Date.now();
      retryAttempt = 0;
      for (const waiter of batch.waiters) waiter.resolve(result);
    } catch (error) {
      options.onError?.(error);
      pending = mergePending(batch, pending);
      retryDelay = Math.min(retryDelayMs * 2 ** retryAttempt, maxRetryDelayMs);
      retryAttempt++;
      throw error;
    } finally {
      inFlight = null;
      if (pending) {
        const intervalDelay = Math.max(0, minIntervalMs - (Date.now() - lastSentAt));
        schedule(retryDelay ?? intervalDelay);
      }
    }
  }

  const enqueue = (state: TState): Promise<TResult> => {
    if (stopped) return Promise.reject(new Error('Outbox is stopped'));

    const promise = new Promise<TResult>((resolve, reject) => {
      const waiter = { resolve, reject };
      if (pending) {
        pending = { state, waiters: [...pending.waiters, waiter] };
      } else {
        pending = { state, waiters: [waiter] };
      }
    });

    if (!inFlight && !timer) {
      const delay = lastSentAt === 0 ? 0 : Math.max(0, minIntervalMs - (Date.now() - lastSentAt));
      schedule(delay);
    }
    return promise;
  };

  const flushNow = async (): Promise<void> => {
    if (stopped) return;
    clearTimer();

    if (inFlight) {
      await inFlight.promise.catch(() => undefined);
    }
    if (pending) await drain();
  };

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    clearTimer();

    if (inFlight) await inFlight.promise.catch(() => undefined);
    const unsent = pending;
    pending = null;
    if (unsent) rejectWaiters(unsent.waiters, new Error('Outbox stopped before send completed'));
  };

  return { enqueue, flushNow, stop };
}
