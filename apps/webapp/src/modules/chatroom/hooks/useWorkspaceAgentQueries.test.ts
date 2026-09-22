import { renderHook } from '@testing-library/react';
import { AgentRoleLifecycleTag } from '@workspace/shared/domain/agent-role';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceAgentConfig } from './useWorkspaceAgentQueries';
import { getWorkspaceAgentRoles } from '../utils/workspaceAgentRoles';

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
    agentWorkspaces: {
      getAgentConfigForWorkspaceRole: 'agentWorkspaces:getAgentConfigForWorkspaceRole',
    },
  },
}));

describe('useWorkspaceAgentConfig', () => {
  beforeEach(() => {
    mockUseSessionQuery.mockReset();
  });

  it('loads only the last configuration for the selected workspace', () => {
    mockUseSessionQuery.mockReturnValueOnce({
      role: 'planner',
      type: 'remote',
      machineId: 'machine-1',
      agentHarness: 'cursor-sdk',
      model: 'big-pickle',
      workingDir: '/workspace/chatroom',
      updatedAt: 123,
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

describe('getWorkspaceAgentRoles', () => {
  it('derives every rendered role from the static structure, including unconfigured ephemeral roles', () => {
    const agents = getWorkspaceAgentRoles({
      teamId: 'duo',
      teamStructureId: 'duo@1',
      teamName: 'Duo',
      entryPoint: 'planner',
      roles: [
        { role: 'planner', lifecycle: AgentRoleLifecycleTag.Permanent, optional: false },
        { role: 'architect', lifecycle: AgentRoleLifecycleTag.Ephemeral, optional: true },
        { role: 'uiux-engineer', lifecycle: AgentRoleLifecycleTag.Ephemeral, optional: true },
        { role: 'builder', lifecycle: AgentRoleLifecycleTag.Permanent, optional: false },
      ],
    });

    expect(agents.map((agent) => agent.role)).toEqual([
      'planner',
      'architect',
      'uiux-engineer',
      'builder',
    ]);
    expect(agents[1]).toMatchObject({
      lifecycle: AgentRoleLifecycleTag.Ephemeral,
      optional: true,
      teamId: 'duo',
    });
    expect(agents[2]).toMatchObject({
      lifecycle: AgentRoleLifecycleTag.Ephemeral,
      optional: true,
      teamId: 'duo',
    });
  });
});
