import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRequestWorkspaceFileTree } from './useRequestWorkspaceFileTree';

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), onAttempt: vi.fn(), onError: vi.fn() }));
vi.mock('convex-helpers/react/sessions', () => ({ useSessionMutation: () => mocks.mutate }));
vi.mock('@/lib/workspaceIdentifier', () => ({ normalizeWorkspaceWorkingDir: (d: string) => d }));

const sink = { onAttempt: mocks.onAttempt, onError: mocks.onError };

describe('useRequestWorkspaceFileTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mutate.mockResolvedValue(undefined);
  });

  it('passes the failure message to the sink exactly once', async () => {
    mocks.mutate.mockRejectedValue(new Error('Authentication required'));
    const { result } = renderHook(() =>
      useRequestWorkspaceFileTree({ machineId: 'm1', workingDir: '/repo', treeSyncFeedback: sink })
    );
    await act(async () => {
      result.current(true);
      await Promise.resolve();
    });
    expect(mocks.onError).toHaveBeenCalledTimes(1);
    expect(mocks.onError).toHaveBeenCalledWith('Authentication required');
  });

  it('uses the fallback text when the rejection is not an Error', async () => {
    mocks.mutate.mockRejectedValue('boom');
    const { result } = renderHook(() =>
      useRequestWorkspaceFileTree({ machineId: 'm1', workingDir: '/repo', treeSyncFeedback: sink })
    );
    await act(async () => {
      result.current(false);
      await Promise.resolve();
    });
    expect(mocks.onError).toHaveBeenCalledWith('Failed to request workspace file tree sync');
  });

  it('signals an attempt before sending and reports nothing on success', async () => {
    const { result } = renderHook(() =>
      useRequestWorkspaceFileTree({ machineId: 'm1', workingDir: '/repo', treeSyncFeedback: sink })
    );
    await act(async () => {
      result.current(false);
      await Promise.resolve();
    });
    expect(mocks.mutate).toHaveBeenCalledWith({ machineId: 'm1', workingDir: '/repo' });
    expect(mocks.onAttempt).toHaveBeenCalledTimes(1);
    expect(mocks.onAttempt.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.mutate.mock.invocationCallOrder[0]
    );
    expect(mocks.onError).not.toHaveBeenCalled();
  });

  it('drops the failure without throwing when no sink is passed', async () => {
    mocks.mutate.mockRejectedValue(new Error('Authentication required'));
    const { result } = renderHook(() =>
      useRequestWorkspaceFileTree({ machineId: 'm1', workingDir: '/repo' })
    );
    await act(async () => {
      result.current(true);
      await Promise.resolve();
    });
    expect(mocks.onError).not.toHaveBeenCalled();
  });

  it('sends nothing and signals nothing when disabled', () => {
    const { result } = renderHook(() =>
      useRequestWorkspaceFileTree({
        machineId: 'm1',
        workingDir: '/repo',
        enabled: false,
        treeSyncFeedback: sink,
      })
    );
    act(() => result.current(true));
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.onAttempt).not.toHaveBeenCalled();
  });
});
