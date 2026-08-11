import type { ConvexClient } from 'convex/browser';
import { describe, expect, it, vi } from 'vitest';

import { waitForEnhancerJobResolution } from './wait-for-enhancer-job.js';

type State = { status: 'pending' | 'running' | 'complete' | 'failed' | 'cancelled' };

function createWsClient() {
  let callback: ((state: State) => void) | undefined;
  const wsClient = {
    onUpdate: vi.fn((_query, _args, onUpdate) => {
      callback = onUpdate;
      return vi.fn();
    }),
  } as unknown as ConvexClient;

  return {
    wsClient,
    emit: (state: State) => callback?.(state),
  };
}

function createParams(wsClient: ConvexClient): any {
  const onFailure = vi.fn().mockResolvedValue(undefined);
  const onExit = vi.fn();
  return {
    sessionId: 'session',
    chatroomId: 'room1',
    jobId: 'job1',
    backend: { mutation: vi.fn(), query: vi.fn() } as any,
    wsClient,
    onFailure,
    onExit,
  };
}

describe('waitForEnhancerJobResolution', () => {
  it('resolves complete from the WebSocket outcome subscription', async () => {
    const { wsClient, emit } = createWsClient();
    const params = createParams(wsClient);
    const promise = waitForEnhancerJobResolution(params);

    emit({ status: 'running' });
    emit({ status: 'complete' });

    await expect(promise).resolves.toBe('complete');
    expect(params.backend.query).not.toHaveBeenCalled();
    expect(params.onFailure).not.toHaveBeenCalled();
  });

  it.each(['failed', 'cancelled'] as const)('resolves %s as failed', async (status) => {
    const { wsClient, emit } = createWsClient();
    const params = createParams(wsClient);
    const promise = waitForEnhancerJobResolution(params);

    emit({ status: 'running' });
    emit({ status });

    await expect(promise).resolves.toBe('failed');
    expect(params.backend.query).not.toHaveBeenCalled();
  });

  it('onExit without a backend outcome triggers failure', async () => {
    const { wsClient, emit } = createWsClient();
    const params = createParams(wsClient);
    const onExitCallbacks: (() => void)[] = [];
    params.onExit = (callback: () => void) => onExitCallbacks.push(callback);
    const promise = waitForEnhancerJobResolution(params);

    emit({ status: 'running' });
    onExitCallbacks[0]?.();

    await expect(promise).resolves.toBe('failed');
    expect(params.onFailure).toHaveBeenCalledWith(
      'Agent process exited without completing enhancer job',
      false
    );
  });

  it('agent_end without complete calls forceTerminal failure', async () => {
    vi.useFakeTimers();
    const { wsClient, emit } = createWsClient();
    const params = createParams(wsClient);
    const onAgentEndCallbacks: (() => void)[] = [];
    params.onAgentEnd = (callback: () => void) => onAgentEndCallbacks.push(callback);
    const promise = waitForEnhancerJobResolution(params);

    emit({ status: 'running' });
    onAgentEndCallbacks[0]?.();
    await vi.advanceTimersByTimeAsync(3_100);

    await expect(promise).resolves.toBe('failed');
    expect(params.onFailure).toHaveBeenCalledWith(
      'Agent exited without completing enhancer job',
      true
    );
    vi.useRealTimers();
  });

  it('agent_end salvages assistant text and waits for the subscribed completion', async () => {
    vi.useFakeTimers();
    const { wsClient, emit } = createWsClient();
    const params = createParams(wsClient);
    const onAgentEndCallbacks: (() => void)[] = [];
    const onAssistantTextCallbacks: ((text: string) => void)[] = [];
    params.onAgentEnd = (callback: () => void) => onAgentEndCallbacks.push(callback);
    params.onAssistantText = (callback: (text: string) => void) =>
      onAssistantTextCallbacks.push(callback);
    params.onSalvageComplete = vi.fn(async () => emit({ status: 'complete' }));
    const promise = waitForEnhancerJobResolution(params);

    emit({ status: 'running' });
    onAssistantTextCallbacks[0]?.('Planning feedback');
    onAgentEndCallbacks[0]?.();
    await vi.advanceTimersByTimeAsync(3_100);

    await expect(promise).resolves.toBe('complete');
    expect(params.onSalvageComplete).toHaveBeenCalledWith('Planning feedback');
    expect(params.onFailure).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
