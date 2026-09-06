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
  api: {
    web: {
      enhancer: {
        index: { getConfig: 'getConfig', upsertConfig: 'upsert', disableConfig: 'disable' },
      },
    },
  },
}));

const complete = {
  enabled: true,
  targetId: 'handoff:planner-to-builder' as const,
  agentHarness: 'opencode' as const,
  model: 'model',
  machineId: 'machine',
  updatedAt: 1,
};

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
    mockMutation
      .mockReturnValueOnce(vi.fn())
      .mockReturnValueOnce(vi.fn().mockRejectedValue(new Error('offline')));
    const { result } = renderHook(() => useEnhancerConfig('room-1'));
    await waitFor(() => expect(result.current.isActive).toBe(false));
    await act(async () => Promise.resolve());
    expect(result.current.isActive).toBe(false);
  });
});

describe('useEnhancerConfig serverIsActive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutation.mockReturnValue(vi.fn().mockResolvedValue(undefined));
  });

  it('returns undefined while server config is loading', () => {
    mockQuery.mockReturnValue(undefined);
    const { result } = renderHook(() => useEnhancerConfig('room-1'));
    expect(result.current.serverIsActive).toBeUndefined();
  });

  it('returns false when server config is null', async () => {
    mockQuery.mockReturnValue(null);
    const { result } = renderHook(() => useEnhancerConfig('room-1'));
    await waitFor(() => expect(result.current.serverIsActive).toBe(false));
  });

  it('returns true when server config is active', async () => {
    mockQuery.mockReturnValue(complete);
    const { result } = renderHook(() => useEnhancerConfig('room-1'));
    await waitFor(() => expect(result.current.serverIsActive).toBe(true));
  });

  it('returns false when server config is enabled but incomplete', async () => {
    mockQuery.mockReturnValue({ ...complete, model: '' });
    const { result } = renderHook(() => useEnhancerConfig('room-1'));
    await waitFor(() => expect(result.current.serverIsActive).toBe(false));
  });

  it('derives from server query not local optimistic state', async () => {
    mockQuery.mockReturnValue(null);
    const { result } = renderHook(() => useEnhancerConfig('room-1'));
    await waitFor(() => expect(result.current.config).toBeNull());

    // serverIsActive should be false regardless of local state — it derives from the server query.
    expect(result.current.serverIsActive).toBe(false);
  });
});

describe('useEnhancerConfig transactional saveConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReturnValue(null);
  });

  it('restores prior config and rethrows when mutation rejects', async () => {
    const priorConfig = {
      enabled: false,
      targetId: 'handoff:planner-to-builder' as const,
      agentHarness: 'cursor' as const,
      model: 'gpt-4',
      machineId: 'machine-1',
    };

    // Seed the store with the prior config via initial query.
    mockQuery.mockReturnValue({
      ...priorConfig,
      enabled: false,
      updatedAt: 1,
    });
    const upsert = vi.fn().mockRejectedValue(new Error('network'));
    mockMutation.mockReturnValue(upsert);

    const { result } = renderHook(() => useEnhancerConfig('room-1'));

    // Wait for hydration to seed config.
    await waitFor(() => expect(result.current.config).toEqual(priorConfig));

    // Attempt to save a new enabled config — should fail and restore prior.
    const newConfig = { ...priorConfig, enabled: true };
    await expect(result.current.saveConfig(newConfig)).rejects.toThrow('network');

    // Config should be restored to the prior state.
    expect(result.current.config).toEqual(priorConfig);
    expect(result.current.isActive).toBe(false);
  });

  it('clears store and rethrows when prior config was null', async () => {
    mockQuery.mockReturnValue(null);
    const upsert = vi.fn().mockRejectedValue(new Error('network'));
    mockMutation.mockReturnValue(upsert);

    const { result } = renderHook(() => useEnhancerConfig('room-1'));
    await waitFor(() => expect(result.current.config).toBeNull());

    const newConfig = {
      enabled: true,
      targetId: 'handoff:planner-to-builder' as const,
      agentHarness: 'cursor' as const,
      model: 'gpt-4',
      machineId: 'machine-1',
    };

    await expect(result.current.saveConfig(newConfig)).rejects.toThrow('network');

    // Config should be restored to null.
    expect(result.current.config).toBeNull();
    expect(result.current.isActive).toBe(false);
  });
});
