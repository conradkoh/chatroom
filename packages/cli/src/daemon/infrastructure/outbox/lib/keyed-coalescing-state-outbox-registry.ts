import {
  createCoalescingStateOutbox,
  type CoalescingStateOutbox,
  type CoalescingStateOutboxOptions,
} from './coalescing-state-outbox.js';
import type { DurableCoalescingStateStore } from './durable-coalescing-state-store.js';
import type { OutboxErrorLogger } from './outbox-failure.js';

export type KeyedCoalescingStateOutboxRegistry<TState, TResult> = {
  enqueue(key: string, state: TState): Promise<void>;
  enqueueAndWait(key: string, state: TState): Promise<TResult>;
  flushNow(key?: string): Promise<void>;
  stop(key: string): Promise<void>;
  stopAll(): Promise<void>;
};

export type KeyedCoalescingStateOutboxRegistryOptions<TState, TResult> = {
  createSend: (key: string) => CoalescingStateOutboxOptions<TState, TResult>['send'];
  minIntervalMs?: number | undefined;
  retryDelayMs?: number | undefined;
  maxRetryDelayMs?: number | undefined;
  onError?: ((key: string, error: unknown) => void) | undefined;
  logger?: OutboxErrorLogger | undefined;
  isPermanentError?: ((error: unknown) => boolean) | undefined;
  store?: DurableCoalescingStateStore | undefined;
  serialize?: ((state: TState) => string) | undefined;
  deserialize?: ((json: string) => TState) | undefined;
};

export function createKeyedCoalescingStateOutboxRegistry<TState, TResult>(
  options: KeyedCoalescingStateOutboxRegistryOptions<TState, TResult>
): KeyedCoalescingStateOutboxRegistry<TState, TResult> {
  const outboxes = new Map<string, CoalescingStateOutbox<TState, TResult>>();
  let stopped = false;
  const getOrCreate = (key: string) => {
    if (stopped) throw new Error('Outbox registry is stopped');
    let outbox = outboxes.get(key);
    if (!outbox) {
      outbox = createCoalescingStateOutbox({
        send: (state) => options.createSend(key)(state),
        minIntervalMs: options.minIntervalMs,
        retryDelayMs: options.retryDelayMs,
        maxRetryDelayMs: options.maxRetryDelayMs,
        onError: (error) => options.onError?.(key, error),
        logger: options.logger,
        isPermanentError: options.isPermanentError,
        ...(options.store
          ? {
              store: options.store,
              deliveryKey: key,
              serialize: options.serialize,
              deserialize: options.deserialize,
            }
          : {}),
      });
      outboxes.set(key, outbox);
    }
    return outbox;
  };
  const stop = async (key: string): Promise<void> => {
    const outbox = outboxes.get(key);
    outboxes.delete(key);
    await outbox?.stop();
  };
  for (const key of options.store?.listPendingKeys() ?? []) getOrCreate(key);
  return {
    enqueue: async (key, state) => getOrCreate(key).enqueue(state),
    enqueueAndWait: async (key, state) => getOrCreate(key).enqueueAndWait(state),
    flushNow: async (key) => {
      if (key) await getOrCreate(key).flushNow();
      else await Promise.all([...outboxes.values()].map((outbox) => outbox.flushNow()));
    },
    stop,
    stopAll: async () => {
      if (stopped) return;
      stopped = true;
      for (const key of [...outboxes.keys()]) await stop(key);
      options.store?.close();
    },
  };
}
