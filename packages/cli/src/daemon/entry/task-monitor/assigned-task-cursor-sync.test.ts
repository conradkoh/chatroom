import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAssignedTaskCursorSync,
  type AssignedTaskChangePage,
} from './assigned-task-cursor-sync.js';
import { clearAssignedTaskSnapshots } from '../../../infrastructure/stores/assigned-task-snapshot-store.js';

describe('assigned task cursor sync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearAssignedTaskSnapshots();
  });
  it('debounces notifications', async () => {
    const fetch = vi.fn().mockResolvedValue({ items: [], highRevision: null, hasMore: false });
    const sync = createAssignedTaskCursorSync({ fetchPage: fetch, isStopped: () => false });
    sync.notifyCursor(1);
    sync.notifyCursor(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
  it('paginates', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        items: [{ revision: 1, op: 'delete', taskId: 't', role: 'r' }],
        highRevision: 1,
        hasMore: true,
      })
      .mockResolvedValueOnce({ items: [], highRevision: null, hasMore: false });
    const sync = createAssignedTaskCursorSync({ fetchPage: fetch, isStopped: () => false });
    await sync.drainNow();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sync.getLastProcessedRevision()).toBe(1);
  });
  it('retries failures', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValueOnce({ items: [], highRevision: null, hasMore: false });
    const sync = createAssignedTaskCursorSync({ fetchPage: fetch, isStopped: () => false });
    await sync.drainNow();
    await sync.drainNow();
    expect(fetch.mock.calls[1]?.[0]).toBe(0);
  });
  it('coalesces concurrent drains', async () => {
    let resolve!: (v: AssignedTaskChangePage) => void;
    const fetch = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<AssignedTaskChangePage>((r) => {
          resolve = r;
        })
      )
      .mockResolvedValue({ items: [], highRevision: null, hasMore: false });
    const sync = createAssignedTaskCursorSync({ fetchPage: fetch, isStopped: () => false });
    const first = sync.drainNow();
    void sync.drainNow();
    resolve({ items: [], highRevision: 1, hasMore: false });
    await first;
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});
