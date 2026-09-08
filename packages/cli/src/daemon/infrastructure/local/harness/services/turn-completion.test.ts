import { describe, expect, it, vi } from 'vitest';

import { createTurnCompletion, turnCompletionFromError } from './turn-completion.js';

describe('turn completion', () => {
  it('accepts exactly one terminal result', async () => {
    const completion = createTurnCompletion('00000000-0000-4000-8000-000000000001');
    const listener = vi.fn();
    completion.onComplete(listener);

    expect(completion.complete({ status: 'completed', source: 'provider.result' })).toBe(true);
    expect(
      completion.complete({ status: 'failed', source: 'late.stream-error', error: 'late' })
    ).toBe(false);

    await expect(completion.result).resolves.toEqual({
      turnId: '00000000-0000-4000-8000-000000000001',
      status: 'completed',
      source: 'provider.result',
    });
    expect(listener).toHaveBeenCalledOnce();
    expect(completion.value?.status).toBe('completed');
  });

  it('notifies listeners registered after completion immediately', () => {
    const completion = createTurnCompletion('00000000-0000-4000-8000-000000000002');
    completion.complete({ status: 'timed_out', source: 'timeout', error: 'expired' });

    const listener = vi.fn();
    const unsubscribe = completion.onComplete(listener);

    expect(listener).toHaveBeenCalledWith({
      turnId: '00000000-0000-4000-8000-000000000002',
      status: 'timed_out',
      source: 'timeout',
      error: 'expired',
    });
    unsubscribe();
  });

  it('classifies timeout errors separately from other failures', () => {
    expect(turnCompletionFromError(new Error('query timed out after 10ms'), 'query')).toEqual({
      status: 'timed_out',
      source: 'query',
      error: 'query timed out after 10ms',
    });
    expect(turnCompletionFromError(new Error('provider rejected request'), 'query')).toEqual({
      status: 'failed',
      source: 'query',
      error: 'provider rejected request',
    });
  });
});
