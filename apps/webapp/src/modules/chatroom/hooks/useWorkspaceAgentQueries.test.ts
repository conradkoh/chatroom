import { renderHook } from '@testing-library/react';
import { AgentRoleLifecycleTag } from '@workspace/shared/domain/agent-role';
import { getTeamStructure } from '@workspace/shared/domain/team-presets';
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
  it.each([
    ['duo', ['planner', 'builder']],
    ['solo', ['solo']],
  ] as const)(
    'derives every rendered %s role from canonical structure when persisted roles omit triage',
    (teamId, persistedRoles) => {
      const structure = getTeamStructure({ teamId, persistedRoles });
      const agents = getWorkspaceAgentRoles(structure);

      expect(agents.map((agent) => agent.role)).toEqual(structure.roles.map(({ role }) => role));
      expect(agents.find(({ role }) => role === 'triage')).toMatchObject({
        lifecycle: AgentRoleLifecycleTag.Ephemeral,
        optional: true,
        teamId,
      });
    }
  );
});
