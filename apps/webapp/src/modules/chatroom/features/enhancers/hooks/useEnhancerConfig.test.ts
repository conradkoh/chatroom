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
    agents: {
      getLastSentLaunchRequest: 'agents:getLastSentLaunchRequest',
      saveConfig: 'agents:saveConfig',
    },
  },
}));

const request = {
  role: 'enhancer',
  agentHarness: 'opencode' as const,
  model: 'model',
  machineId: 'machine',
  workingDir: '/workspace',
  requestedAt: 1,
};

describe('useEnhancerConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutation.mockReturnValue(vi.fn().mockResolvedValue(undefined));
    mockQuery.mockReturnValue(null);
  });

  it('hydrates from the shared enhancer launch-request snapshot', async () => {
    mockQuery.mockReturnValue(request);
    const { result } = renderHook(() =>
      useEnhancerConfig('room-1', {
        workspaceId: 'workspace-1',
        workingDir: '/workspace',
      })
    );

    await waitFor(() => expect(result.current.config?.model).toBe('model'));
    expect(result.current.isActive).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith('agents:getLastSentLaunchRequest', {
      chatroomId: 'room-1',
      role: 'enhancer',
      workspaceId: 'workspace-1',
    });
  });

  it('saves through the shared agent configuration mutation', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    mockMutation.mockReturnValue(save);
    const { result } = renderHook(() =>
      useEnhancerConfig('room-1', {
        workspaceId: 'workspace-1',
        workingDir: '/workspace',
      })
    );
    const config = {
      enabled: true,
      targetId: 'handoff:planner-to-builder' as const,
      agentHarness: 'cursor-sdk' as const,
      model: 'cursor/model',
      machineId: 'machine',
    };

    await act(async () => result.current.saveConfig(config));
    expect(save).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      workspaceId: 'workspace-1',
      role: 'enhancer',
      machineId: 'machine',
      agentHarness: 'cursor-sdk',
      model: 'cursor/model',
      workingDir: '/workspace',
    });
  });

  it('keeps the reusable configuration when enhanced mode is disabled', async () => {
    mockQuery.mockReturnValue(request);
    const { result } = renderHook(() => useEnhancerConfig('room-1'));
    await waitFor(() => expect(result.current.config).not.toBeNull());
    await act(async () => result.current.disable());
    expect(result.current.config?.model).toBe('model');
  });
});
