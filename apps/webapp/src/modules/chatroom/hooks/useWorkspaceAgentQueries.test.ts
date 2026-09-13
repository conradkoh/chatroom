import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceAgentConfig } from './useWorkspaceAgentQueries';

const mockUseSessionQuery = vi.fn();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (...args: unknown[]) => mockUseSessionQuery(...args),
  useSessionMutation: () => vi.fn(),
}));

vi.mock('../context/ChatroomWorkspaceContext', () => ({
  useChatroomWorkspace: () => ({
    chatroomId: 'room-1',
    workspaces: [],
    activeWorkspace: null,
    isLoading: false,
    setPrimaryWorkspace: vi.fn(),
    removeWorkspace: vi.fn(),
  }),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    agents: {
      getLastSentLaunchRequest: 'agents:getLastSentLaunchRequest',
    },
  },
}));

describe('useWorkspaceAgentConfig', () => {
  beforeEach(() => {
    mockUseSessionQuery.mockReset();
  });

  it('falls back to the chatroom snapshot when the workspace lookup has no row', () => {
    mockUseSessionQuery.mockReturnValueOnce(null).mockReturnValueOnce({
      role: 'planner',
      agentType: 'remote',
      machineId: 'machine-1',
      agentHarness: 'cursor-sdk',
      model: 'big-pickle',
      workingDir: '/workspace/chatroom',
      requestedAt: 123,
    });

    const { result } = renderHook(() => useWorkspaceAgentConfig('workspace-1', 'planner'));

    expect(result.current.config).toMatchObject({
      role: 'planner',
      machineId: 'machine-1',
      agentHarness: 'cursor-sdk',
      model: 'big-pickle',
      workingDir: '/workspace/chatroom',
      updatedAt: 123,
    });
    expect(result.current.isLoading).toBe(false);
  });
});
