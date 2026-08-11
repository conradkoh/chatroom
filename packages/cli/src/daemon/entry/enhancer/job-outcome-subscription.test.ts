import type { ConvexClient } from 'convex/browser';
import { describe, expect, it, vi } from 'vitest';

import { subscribeToEnhancerJobOutcome } from './job-outcome-subscription.js';

function createWsClient() {
  let callback: ((state: unknown) => void) | undefined;
  const unsubscribe = vi.fn();
  const wsClient = {
    onUpdate: vi.fn((_query, _args, onUpdate) => {
      callback = onUpdate;
      return unsubscribe;
    }),
  } as unknown as ConvexClient;
  return { wsClient, unsubscribe, emit: (state: unknown) => callback?.(state) };
}

describe('subscribeToEnhancerJobOutcome', () => {
  it('keeps the latest state and resolves on a terminal outcome', async () => {
    const { wsClient, unsubscribe, emit } = createWsClient();
    const subscription = subscribeToEnhancerJobOutcome({
      wsClient,
      sessionId: 'session',
      chatroomId: 'room',
      jobId: 'job',
    });

    emit({ status: 'running', attemptCount: 1, maxAttempts: 3 });
    expect(subscription.getCurrentState()?.status).toBe('running');
    emit({ status: 'complete', attemptCount: 1, maxAttempts: 3 });

    await expect(subscription.outcome).resolves.toMatchObject({ status: 'complete' });
    subscription.stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('rejects when the WebSocket subscription reports an error', async () => {
    let onError: ((error: unknown) => void) | undefined;
    const wsClient = {
      onUpdate: vi.fn((_query, _args, _onUpdate, errorCallback) => {
        onError = errorCallback;
        return vi.fn();
      }),
    } as unknown as ConvexClient;
    const subscription = subscribeToEnhancerJobOutcome({
      wsClient,
      sessionId: 'session',
      chatroomId: 'room',
      jobId: 'job',
    });

    const error = new Error('connection lost');
    onError?.(error);
    await expect(subscription.outcome).rejects.toThrow('connection lost');
  });
});
