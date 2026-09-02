import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFileTreeWatchLease } from './useFileTreeWatchLease';

const adjustWatch = vi.fn(() => Promise.resolve({ watchCount: 1 }));
const renewWatch = vi.fn(() => Promise.resolve({ watchCount: 1, expiresAt: Date.now() }));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: (reference: { name: string }) =>
    reference.name === 'renewFileTreeWatchLease' ? renewWatch : adjustWatch,
}));
vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    workspaceFiles: {
      adjustFileTreeWatch: { name: 'adjustFileTreeWatch' },
      renewFileTreeWatchLease: { name: 'renewFileTreeWatchLease' },
    },
  },
}));

describe('useFileTreeWatchLease', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('acquires, renews immediately, and renews again on the heartbeat interval', async () => {
    const { unmount } = renderHook(() => useFileTreeWatchLease('machine-1', '/repo/', true));

    expect(adjustWatch).toHaveBeenCalledWith({
      machineId: 'machine-1',
      workingDir: '/repo',
      delta: 1,
    });
    expect(renewWatch).toHaveBeenCalledWith({
      machineId: 'machine-1',
      workingDir: '/repo',
    });

    await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
    expect(renewWatch).toHaveBeenCalledTimes(2);

    unmount();
    expect(adjustWatch).toHaveBeenLastCalledWith({
      machineId: 'machine-1',
      workingDir: '/repo',
      delta: -1,
    });
  });
});
