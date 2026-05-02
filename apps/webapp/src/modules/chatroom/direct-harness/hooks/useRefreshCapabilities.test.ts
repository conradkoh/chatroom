/**
 * Unit tests for the useRefreshCapabilities hook.
 */

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequestRefresh = vi.fn();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mockRequestRefresh,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    chatroom: {
      directHarness: {
        capabilities: {
          requestRefresh: 'mock:requestRefresh',
        },
      },
    },
  },
}));

import { useRefreshCapabilities } from './useRefreshCapabilities';

const WORKSPACE_ID = 'ws-test' as never;

describe('useRefreshCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestRefresh.mockResolvedValue({ taskId: 'task-1' });
  });

  it('starts with isRefreshing = false', () => {
    const { result } = renderHook(() => useRefreshCapabilities());
    expect(result.current.isRefreshing).toBe(false);
  });

  it('sets isRefreshing true while mutation is in-flight, false after resolve', async () => {
    let resolve!: (v: { taskId: string }) => void;
    const pending = new Promise<{ taskId: string }>((res) => {
      resolve = res;
    });
    mockRequestRefresh.mockReturnValue(pending);

    const { result } = renderHook(() => useRefreshCapabilities());

    act(() => {
      result.current.refresh(WORKSPACE_ID);
    });

    expect(result.current.isRefreshing).toBe(true);

    await act(async () => {
      resolve({ taskId: 'task-1' });
      await pending;
    });

    expect(result.current.isRefreshing).toBe(false);
  });

  it('calls requestRefresh mutation with the given workspaceId', async () => {
    const { result } = renderHook(() => useRefreshCapabilities());

    await act(async () => {
      result.current.refresh(WORKSPACE_ID);
      await Promise.resolve();
    });

    expect(mockRequestRefresh).toHaveBeenCalledWith({ workspaceId: WORKSPACE_ID });
  });

  it('calls onError callback on failure but does not throw', async () => {
    const error = new Error('network error');
    mockRequestRefresh.mockRejectedValue(error);

    const onError = vi.fn();
    const { result } = renderHook(() => useRefreshCapabilities({ onError }));

    await act(async () => {
      result.current.refresh(WORKSPACE_ID);
      await Promise.resolve();
    });

    expect(onError).toHaveBeenCalledWith(error);
    // isRefreshing should reset after failure
    expect(result.current.isRefreshing).toBe(false);
  });

  it('does not fire a second refresh while one is in-flight', async () => {
    let resolve!: (v: { taskId: string }) => void;
    const pending = new Promise<{ taskId: string }>((res) => {
      resolve = res;
    });
    mockRequestRefresh.mockReturnValue(pending);

    const { result } = renderHook(() => useRefreshCapabilities());

    act(() => {
      result.current.refresh(WORKSPACE_ID);
    });

    // Second call while isRefreshing should be a no-op
    act(() => {
      result.current.refresh(WORKSPACE_ID);
    });

    expect(mockRequestRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve({ taskId: 'task-1' });
    });
  });
});
