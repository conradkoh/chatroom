import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pollFileWriteRequest } from './fileWritePolling';

const FILE_WRITE_POLL_INTERVAL_MS = 500;

describe('pollFileWriteRequest', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves when status becomes done', async () => {
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce({ status: 'pending' as const })
      .mockResolvedValueOnce({ status: 'done' as const });

    const promise = pollFileWriteRequest(
      queryFn,
      'req-1' as Id<'chatroom_workspaceFileWriteRequests'>
    );

    await vi.advanceTimersByTimeAsync(FILE_WRITE_POLL_INTERVAL_MS);
    await promise;

    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it('throws when status is error', async () => {
    const queryFn = vi.fn().mockResolvedValue({
      status: 'error' as const,
      errorMessage: 'File already exists',
    });

    await expect(
      pollFileWriteRequest(queryFn, 'req-2' as Id<'chatroom_workspaceFileWriteRequests'>)
    ).rejects.toThrow('File already exists');
  });

  it('times out when status stays pending', async () => {
    const queryFn = vi.fn().mockResolvedValue({ status: 'pending' as const });

    const promise = pollFileWriteRequest(
      queryFn,
      'req-3' as Id<'chatroom_workspaceFileWriteRequests'>
    );

    const assertion = expect(promise).rejects.toThrow('timed out');
    await vi.runAllTimersAsync();
    await assertion;
  });
});
