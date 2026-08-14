import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEnhancerConfig } from './useEnhancerConfig';

const mockQuery = vi.fn();
const mockMutation = vi.fn();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (...args: unknown[]) => mockQuery(...args),
  useSessionMutation: (...args: unknown[]) => mockMutation(...args),
}));
vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: { web: { enhancer: { index: { getConfig: 'getConfig', upsertConfig: 'upsert', disableConfig: 'disable' } } } },
}));

const complete = { enabled: true, targetId: 'handoff:planner-to-builder' as const, agentHarness: 'opencode' as const, model: 'model', machineId: 'machine', updatedAt: 1 };

describe('useEnhancerConfig hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutation.mockReturnValue(vi.fn().mockResolvedValue(undefined));
  });

  it('auto-disables stale enabled config once', async () => {
    const disable = vi.fn().mockResolvedValue(undefined);
    mockMutation.mockReturnValueOnce(vi.fn()).mockReturnValueOnce(disable);
    mockQuery.mockReturnValue({ ...complete, model: '' });
    const { result } = renderHook(() => useEnhancerConfig('room-1'));
    await waitFor(() => expect(disable).toHaveBeenCalledWith({ chatroomId: 'room-1' }));
    expect(result.current.isActive).toBe(false);
    expect(disable).toHaveBeenCalledTimes(1);
  });

  it('keeps complete enabled config active without disabling', async () => {
    mockQuery.mockReturnValue(complete);
    const disable = vi.fn();
    mockMutation.mockReturnValueOnce(vi.fn()).mockReturnValueOnce(disable);
    const { result } = renderHook(() => useEnhancerConfig('room-1'));
    await waitFor(() => expect(result.current.isActive).toBe(true));
    expect(disable).not.toHaveBeenCalled();
  });

  it('keeps stale config inactive when disable rejects', async () => {
    mockQuery.mockReturnValue({ ...complete, machineId: ' ' });
    mockMutation.mockReturnValueOnce(vi.fn()).mockReturnValueOnce(vi.fn().mockRejectedValue(new Error('offline')));
    const { result } = renderHook(() => useEnhancerConfig('room-1'));
    await waitFor(() => expect(result.current.isActive).toBe(false));
    await act(async () => Promise.resolve());
    expect(result.current.isActive).toBe(false);
  });
});
