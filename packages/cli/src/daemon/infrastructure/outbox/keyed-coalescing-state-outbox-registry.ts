import {
  createCoalescingStateOutbox,
  type CoalescingStateOutbox,
  type CoalescingStateOutboxOptions,
} from './coalescing-state-outbox.js';

export type KeyedCoalescingStateOutboxRegistry<TState, TResult> = {
  enqueue(key: string, state: TState): Promise<TResult>;
  stop(key: string): Promise<void>;
  stopAll(): Promise<void>;
};

export type KeyedCoalescingStateOutboxRegistryOptions<TState, TResult> = {
  createSend: (key: string) => CoalescingStateOutboxOptions<TState, TResult>['send'];
  minIntervalMs?: number;
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
  onError?: (key: string, error: unknown) => void;
};

export function createKeyedCoalescingStateOutboxRegistry<TState, TResult>(
  options: KeyedCoalescingStateOutboxRegistryOptions<TState, TResult>
): KeyedCoalescingStateOutboxRegistry<TState, TResult> {
  const outboxes = new Map<string, CoalescingStateOutbox<TState, TResult>>();
  const getOrCreate = (key: string) => {
    let outbox = outboxes.get(key);
    if (!outbox) {
      outbox = createCoalescingStateOutbox({
        send: (state) => options.createSend(key)(state),
        minIntervalMs: options.minIntervalMs,
        retryDelayMs: options.retryDelayMs,
        maxRetryDelayMs: options.maxRetryDelayMs,
        onError: (error) => options.onError?.(key, error),
      });
      outboxes.set(key, outbox);
    }
    return outbox;
  };
  const stop = async (key: string): Promise<void> => {
    const outbox = outboxes.get(key);
    outboxes.delete(key);
    await outbox?.flushNow().catch(() => undefined);
    await outbox?.stop().catch(() => undefined);
  };
  return {
    enqueue: (key, state) => getOrCreate(key).enqueue(state),
    stop,
    stopAll: async () => {
      for (const key of [...outboxes.keys()]) await stop(key);
    },
  };
}
