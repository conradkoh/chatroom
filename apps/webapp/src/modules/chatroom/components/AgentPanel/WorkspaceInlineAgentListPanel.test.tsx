import { render, screen } from '@testing-library/react';
import { getTeamStructure } from '@workspace/shared/domain/team-presets';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceInlineAgentListPanel } from './WorkspaceInlineAgentListPanel';
import type * as WorkspaceAgentQueries from '../../hooks/useWorkspaceAgentQueries';

const mocks = vi.hoisted(() => ({
  useSessionQuery: vi.fn(),
  useWorkspaceAgentControlData: vi.fn(),
  useAgentControls: vi.fn(),
  workspace: null as unknown,
  team: null as unknown,
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (...args: unknown[]) => mocks.useSessionQuery(...args),
  useSessionMutation: () => vi.fn(),
}));

vi.mock('../../context/ChatroomWorkspaceContext', () => ({
  useChatroomWorkspace: () => mocks.workspace,
}));

vi.mock('../../hooks/useChatroomTeam', () => ({
  useChatroomTeam: () => mocks.team,
}));

vi.mock('../../hooks/useWorkspaceAgentQueries', async (importOriginal) => {
  const actual = await importOriginal<typeof WorkspaceAgentQueries>();
  return {
    ...actual,
    useWorkspaceAgentControlData: () => mocks.useWorkspaceAgentControlData(),
  };
});

vi.mock('../../workspace/hooks/useChatroomWorkspaces', () => ({
  useChatroomWorkspaces: () => ({ workspaces: [], isLoading: false, removeWorkspace: vi.fn() }),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    agentWorkspaces: {
      getAgentConfigForWorkspaceRole: 'agentWorkspaces:getAgentConfigForWorkspaceRole',
      getAgentStatusForWorkspaceRole: 'agentWorkspaces:getAgentStatusForWorkspaceRole',
    },
    agents: {
      getLastSentLaunchRequest: 'agents:getLastSentLaunchRequest',
      getStatus: 'agents:getStatus',
    },
    machines: {
      getAgentRestartSummariesByRoles: 'machines:getAgentRestartSummariesByRoles',
      getAgentRestartSummaryByRole: 'machines:getAgentRestartSummaryByRole',
    },
  },
}));

vi.mock('../AgentControls', () => ({
  useAgentControls: (...args: unknown[]) => mocks.useAgentControls(...args),
  RemoteTabContent: () => <div data-testid="remote-tab">Remote</div>,
  CustomTabContent: () => null,
}));

vi.mock('./AgentControlsSection', () => ({
  AgentControlsSection: () => <div data-testid="controls-section" />,
}));

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
  chatroomId: 'jd7testchatroom0000000000000001',
  workspaces: [activeWorkspace],
  activeWorkspace,
  isLoading: false,
  setPrimaryWorkspace: vi.fn(),
  removeWorkspace: vi.fn(),
};

const teamFacts = [
  {
    teamId: 'duo',
    permanentRoles: ['planner', 'builder'],
    ephemeralRoles: ['architect', 'triage', 'uiux-engineer'],
  },
  {
    teamId: 'solo',
    permanentRoles: ['solo'],
    ephemeralRoles: ['architect', 'triage', 'uiux-engineer'],
  },
] as const;

function mockBoundaries(structure: ReturnType<typeof getTeamStructure> | null | undefined) {
  mocks.workspace = workspaceContext;
  mocks.team = { structure, isLoading: structure === undefined };
  mocks.useSessionQuery.mockReset();
  mocks.useSessionQuery.mockReturnValue(null);
  mocks.useWorkspaceAgentControlData.mockReturnValue({
    machines: [],
    daemonConnectivity: new Map(),
    isLoadingMachines: false,
    agentConfigs: [],
    sendCommand: vi.fn(),
  });
  mocks.useAgentControls.mockReset();
  mocks.useAgentControls.mockReturnValue({
    selectedHarness: null,
    selectedModel: null,
    selectedMachineId: null,
    selectedWorkingDir: null,
    isStarting: false,
    isStopping: false,
    handleStart: vi.fn(),
    handleStop: vi.fn(),
    setSelectedHarness: vi.fn(),
    setSelectedModel: vi.fn(),
    setSelectedMachineId: vi.fn(),
    setSelectedWorkingDir: vi.fn(),
  });
}

describe('WorkspaceInlineAgentListPanel canonical directory rendering', () => {
  it.each(teamFacts)(
    'renders every $teamId role once in permanent-first order without saved configuration',
    ({ teamId, permanentRoles, ephemeralRoles }) => {
      const structure = getTeamStructure({ teamId, persistedRoles: permanentRoles });
      mockBoundaries(structure);
      render(<WorkspaceInlineAgentListPanel chatroomId={workspaceContext.chatroomId} />);

      const expectedRoles = [...permanentRoles, ...ephemeralRoles];
      const roleNodes = expectedRoles.map((role) => {
        const matches = screen.getAllByText(role, { exact: true });
        expect(matches).toHaveLength(1);
        return matches[0]!;
      });
      expect(screen.getByText(`Ephemeral (${ephemeralRoles.length})`)).toBeInTheDocument();
      expect(roleNodes.map((node) => node.textContent)).toEqual(expectedRoles);
      const heading = screen.getByText(`Ephemeral (${ephemeralRoles.length})`);
      expect(
        roleNodes[permanentRoles.length - 1]!.compareDocumentPosition(heading) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
        heading.compareDocumentPosition(roleNodes[permanentRoles.length]!) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      for (const node of roleNodes) {
        expect(node.closest('div.border-b')).toHaveTextContent(/OFFLINE/i);
      }
      expect(screen.queryByText(/^enhancer$/i)).not.toBeInTheDocument();

      const configCalls = mocks.useSessionQuery.mock.calls.filter(
        ([query]) => query === 'agentWorkspaces:getAgentConfigForWorkspaceRole'
      );
      const statusCalls = mocks.useSessionQuery.mock.calls.filter(
        ([query]) => query === 'agentWorkspaces:getAgentStatusForWorkspaceRole'
      );
      expect(configCalls.map(([, args]) => args)).toEqual(
        expectedRoles.map((role) => ({ workspaceId: activeWorkspace._registryId, role }))
      );
      expect(statusCalls.map(([, args]) => args)).toEqual(
        expectedRoles.map((role) => ({ workspaceId: activeWorkspace._registryId, role }))
      );
      expect(mocks.useAgentControls.mock.calls.map(([args]) => args)).toEqual(
        expectedRoles.map((role) =>
          expect.objectContaining({
            role,
            chatroomId: workspaceContext.chatroomId,
            workspaceId: activeWorkspace._registryId,
            teamId,
          })
        )
      );
      const restartSummaryCall = mocks.useSessionQuery.mock.calls.find(
        ([query]) => query === 'machines:getAgentRestartSummariesByRoles'
      );
      expect(restartSummaryCall?.[1]).toEqual({
        chatroomId: workspaceContext.chatroomId,
        roles: structure.roles.map(({ role }) => role),
      });
    }
  );

  it('renders Loading agents while workspace or team structure is loading', () => {
    mockBoundaries(undefined);
    mocks.workspace = { ...workspaceContext, isLoading: true };
    render(<WorkspaceInlineAgentListPanel chatroomId={workspaceContext.chatroomId} />);

    expect(screen.getByText('Loading agents...')).toBeInTheDocument();
    expect(screen.queryByText('triage')).not.toBeInTheDocument();
  });

  it('renders No active workspace without changing directory membership', () => {
    mockBoundaries(getTeamStructure({ teamId: 'duo' }));
    mocks.workspace = { ...workspaceContext, activeWorkspace: null };
    render(<WorkspaceInlineAgentListPanel chatroomId={workspaceContext.chatroomId} />);

    expect(screen.getByText('No active workspace')).toBeInTheDocument();
    expect(screen.queryByText('triage')).not.toBeInTheDocument();
  });

  it('renders No agents in team structure for an empty custom structure', () => {
    const emptyStructure = getTeamStructure({ teamId: 'custom-team', persistedRoles: [] });
    mockBoundaries({ ...emptyStructure, roles: [] });
    render(<WorkspaceInlineAgentListPanel chatroomId={workspaceContext.chatroomId} />);

    expect(screen.getByText('No agents in team structure')).toBeInTheDocument();
  });
});
