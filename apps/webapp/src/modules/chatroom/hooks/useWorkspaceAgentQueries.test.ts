import { renderHook } from '@testing-library/react';
import { AgentRoleLifecycleTag } from '@workspace/shared/domain/agent-role';
import { getTeamStructure } from '@workspace/shared/domain/team-presets';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceAgentConfig, useWorkspaceAgentDirectory } from './useWorkspaceAgentQueries';
import { getWorkspaceAgentRoles } from '../utils/workspaceAgentRoles';

const mocks = vi.hoisted(() => ({
  useSessionQuery: vi.fn(),
  useChatroomWorkspace: vi.fn(),
  useChatroomTeam: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (...args: unknown[]) => mocks.useSessionQuery(...args),
  useSessionMutation: () => vi.fn(),
}));

vi.mock('../context/ChatroomWorkspaceContext', () => ({
  useChatroomWorkspace: (...args: unknown[]) => mocks.useChatroomWorkspace(...args),
}));

vi.mock('./useChatroomTeam', () => ({
  useChatroomTeam: (...args: unknown[]) => mocks.useChatroomTeam(...args),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    agentWorkspaces: {
      getAgentConfigForWorkspaceRole: 'agentWorkspaces:getAgentConfigForWorkspaceRole',
    },
  },
}));

const teamFacts = [
  {
    teamId: 'duo',
    persistedRoles: ['planner', 'builder'],
    roles: ['planner', 'architect', 'researcher', 'triage', 'uiux-engineer', 'builder'],
    permanentRoles: ['planner', 'builder'],
    ephemeralRoles: ['architect', 'researcher', 'triage', 'uiux-engineer'],
  },
  {
    teamId: 'solo',
    persistedRoles: ['solo'],
    roles: ['solo', 'architect', 'triage', 'uiux-engineer'],
    permanentRoles: ['solo'],
    ephemeralRoles: ['architect', 'triage', 'uiux-engineer'],
  },
] as const;

const activeWorkspace = {
  id: 'unassigned::/workspace/chatroom',
  machineId: null,
  hostname: 'Unassigned',
  workingDir: '/workspace/chatroom',
  agentRoles: [],
  _registryId: 'workspace-registry-active',
  fileTreeSyncEnabled: true,
};

const workspaceContext = {
  chatroomId: 'room-1',
  workspaces: [activeWorkspace],
  activeWorkspace,
  isLoading: false,
  setPrimaryWorkspace: vi.fn(),
  removeWorkspace: vi.fn(),
};

describe('useWorkspaceAgentConfig', () => {
  beforeEach(() => {
    mocks.useSessionQuery.mockReset();
    mocks.useChatroomWorkspace.mockReturnValue(workspaceContext);
    mocks.useChatroomTeam.mockReset();
  });

  it('loads only the last configuration for the selected workspace', () => {
    mocks.useSessionQuery.mockReturnValueOnce({
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
  it.each(teamFacts)(
    'derives every declared $teamId role and lifecycle when saved roles omit support roles',
    ({ teamId, persistedRoles, roles, permanentRoles, ephemeralRoles }) => {
      const structure = getTeamStructure({ teamId, persistedRoles });
      const agents = getWorkspaceAgentRoles(structure);

      expect(agents.map(({ role }) => role)).toEqual(roles);
      expect(agents.map(({ teamId: actualTeamId }) => actualTeamId)).toEqual(
        roles.map(() => teamId)
      );
      expect(
        agents
          .filter(({ lifecycle }) => lifecycle === AgentRoleLifecycleTag.Permanent)
          .map(({ role }) => role)
      ).toEqual(permanentRoles);
      expect(
        agents
          .filter(({ lifecycle }) => lifecycle === AgentRoleLifecycleTag.Ephemeral)
          .map(({ role }) => role)
      ).toEqual(ephemeralRoles);
      expect(agents.find(({ role }) => role === 'triage')).toMatchObject({
        lifecycle: AgentRoleLifecycleTag.Ephemeral,
        optional: true,
        teamId,
      });
    }
  );

  it('preserves custom-team roles while excluding the user identity', () => {
    const structure = getTeamStructure({
      teamId: 'custom-team',
      persistedRoles: ['reviewer', 'user'],
      persistedEntryPoint: 'reviewer',
    });

    expect(getWorkspaceAgentRoles(structure)).toEqual([
      {
        role: 'reviewer',
        lifecycle: AgentRoleLifecycleTag.Permanent,
        optional: false,
        teamId: 'custom-team',
      },
    ]);
  });

  it.each([null, undefined])(
    'returns an empty directory for an unresolved structure (%s)',
    (structure) => {
      expect(getWorkspaceAgentRoles(structure)).toEqual([]);
    }
  );
});

describe('useWorkspaceAgentDirectory', () => {
  beforeEach(() => {
    mocks.useSessionQuery.mockReset();
    mocks.useChatroomWorkspace.mockReturnValue(workspaceContext);
    mocks.useChatroomTeam.mockReset();
  });

  it.each(teamFacts)(
    'composes the real $teamId directory independently of runtime configs/status/machines',
    ({ teamId, persistedRoles, roles }) => {
      const structure = getTeamStructure({ teamId, persistedRoles });
      mocks.useChatroomTeam.mockReturnValue({
        structure,
        isLoading: false,
      });

      const { result } = renderHook(() => useWorkspaceAgentDirectory());

      expect(result.current.workspace).toBe(activeWorkspace);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.agents.map(({ role }) => role)).toEqual(roles);
      expect(result.current.agents.map(({ teamId: actualTeamId }) => actualTeamId)).toEqual(
        roles.map(() => teamId)
      );
      expect(result.current.agents.find(({ role }) => role === 'triage')).toMatchObject({
        lifecycle: AgentRoleLifecycleTag.Ephemeral,
        optional: true,
        teamId,
      });
      expect(mocks.useSessionQuery).not.toHaveBeenCalled();
    }
  );

  it('keeps an empty directory while structure is unresolved and reflects loading boundaries', () => {
    mocks.useChatroomTeam.mockReturnValue({ structure: undefined, isLoading: true });
    mocks.useChatroomWorkspace.mockReturnValue({ ...workspaceContext, isLoading: true });

    const { result } = renderHook(() => useWorkspaceAgentDirectory());

    expect(result.current.agents).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });
});
