import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCoalescingStateOutbox } from './coalescing-state-outbox.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('coalescing-state-outbox', () => {
  it('sends the first state immediately and coalesces a state queued in flight', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstSend = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const send = vi.fn(async (state: number) => {
      if (state === 1) await firstSend;
      return state;
    });
    const outbox = createCoalescingStateOutbox({ send, minIntervalMs: 0 });

    const first = outbox.enqueue(1);
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(1));
    const second = outbox.enqueue(2);

    releaseFirst?.();
    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(2);
    expect(send.mock.calls.map(([state]) => state)).toEqual([1, 2]);

    await outbox.stop();
  });

  it('waits for the configured minimum interval between successful sends', async () => {
    vi.useFakeTimers();
    const send = vi.fn(async (state: number) => state);
    const outbox = createCoalescingStateOutbox({ send, minIntervalMs: 100 });

    const first = outbox.enqueue(1);
    await vi.runOnlyPendingTimersAsync();
    await expect(first).resolves.toBe(1);

    const second = outbox.enqueue(2);
    await vi.advanceTimersByTimeAsync(99);
    expect(send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(second).resolves.toBe(2);
    expect(send).toHaveBeenCalledTimes(2);

    await outbox.stop();
  });

  it('flushes pending state on stop before completing', async () => {
    vi.useFakeTimers();
    const send = vi.fn(async (state: number) => state);
    const outbox = createCoalescingStateOutbox({ send, minIntervalMs: 100 });
    const pending = outbox.enqueue(1);
    await outbox.stop();
    await expect(pending).resolves.toBe(1);
    expect(send).toHaveBeenCalledWith(1);
  });

  it('retains the latest state and retries after a failed send', async () => {
    vi.useFakeTimers();
    const send = vi
      .fn<(state: number) => Promise<number>>()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(2);
    const onError = vi.fn();
    const outbox = createCoalescingStateOutbox({
      send,
      minIntervalMs: 0,
      retryDelayMs: 10,
      onError,
    });

    const result = outbox.enqueue(2);
    await vi.runOnlyPendingTimersAsync();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10);
    await expect(result).resolves.toBe(2);
    expect(send).toHaveBeenCalledTimes(2);

    await outbox.stop();
  });
});
