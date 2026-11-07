import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { getTeamStructure } from '@workspace/shared/domain/team-presets';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentPanel } from '../AgentPanel';

const mocks = vi.hoisted(() => ({
  favoritesByKey: {} as Record<string, { agentHarness: string; model: string }[] | undefined>,
  saveConfig: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  teamStructure: undefined as unknown,
  workspaceContext: null as unknown,
}));

vi.mock('convex/react', () => ({
  useQueries: (queries: Record<string, { args: { machineId: string; teamRoleKey: string } }>) =>
    Object.fromEntries(
      Object.entries(queries).map(([key, { args }]) => {
        const favorites = mocks.favoritesByKey[`${args.machineId}|${args.teamRoleKey}`];
        return [key, favorites === undefined ? undefined : { favorites }];
      })
    ),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-1'],
  useSessionMutation: () => mocks.saveConfig,
  useSessionQuery: (ref: unknown) =>
    ref === 'chatrooms:getTeamStructureForChatroom' ? mocks.teamStructure : undefined,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    machineConfigFavorites: {
      getMachineConfigFavorites: 'machineConfigFavorites:getMachineConfigFavorites',
    },
    agents: { saveConfig: 'agents:saveConfig' },
    chatrooms: { getTeamStructureForChatroom: 'chatrooms:getTeamStructureForChatroom' },
    machines: { listMachines: 'machines:listMachines' },
  },
}));

vi.mock('../../context/ChatroomWorkspaceContext', () => ({
  useChatroomWorkspace: () => mocks.workspaceContext,
}));

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock('./CommandQueuePanel', () => ({
  CommandQueuePanel: () => <div data-testid="command-queue-panel" />,
}));
vi.mock('./TeamSelectorDropdown', () => ({
  TeamSelectorDropdown: () => <div data-testid="team-selector" />,
}));

const activeWorkspace = {
  id: 'm1::/repo',
  machineId: 'm1',
  hostname: 'host-a',
  workingDir: '/repo',
  agentRoles: [],
  _registryId: 'ws-1',
  fileTreeSyncEnabled: false,
};

const workspaceContext = {
  chatroomId: 'room-1',
  workspaces: [activeWorkspace],
  activeWorkspace,
  isLoading: false,
  setPrimaryWorkspace: vi.fn(),
  removeWorkspace: vi.fn(),
};

function seedTeam(
  teamId: string,
  overrides: Record<string, { agentHarness: string; model: string }[]>
) {
  const structure = getTeamStructure({ teamId });
  for (const { role } of structure.roles) {
    mocks.favoritesByKey[`m1|team_${teamId}#role_${role.toLowerCase()}`] = overrides[role] ?? [];
  }
  return structure;
}

const baseLifecycle = {
  teamId: 'duo',
  teamName: 'Duo',
  expectedRoles: getTeamStructure({ teamId: 'duo' }).roles.map(({ role }) => role),
  participants: [],
  hasHistory: false,
};

function renderPanel() {
  return render(
    <AgentPanel
      machineId={null}
      lifecycle={baseLifecycle}
      teamStructure={getTeamStructure({ teamId: 'duo' })}
      statusReadModel={[]}
      teamName="Duo"
      teamId="duo"
      defaultTeamId="duo"
      teams={[
        {
          id: 'duo',
          name: 'Duo',
          description: '',
          roles: ['planner', 'builder'],
          entryPoint: 'planner',
        },
      ]}
      onTeamChange={async () => {}}
      agentConfigs={[]}
      onOpenAgent={vi.fn()}
      onOpenAgents={vi.fn()}
      hasRunningRemoteAgents={false}
      canStopRemoteAgents={false}
      onStartAllRemoteAgents={vi.fn()}
      onStopAllRemoteAgents={vi.fn()}
      onRestartAllRemoteAgents={vi.fn()}
      isStoppingAgents={false}
      isStartingAllAgents={false}
    />
  );
}

describe('AgentPanel apply top favourites', () => {
  beforeEach(() => {
    mocks.favoritesByKey = {};
    mocks.saveConfig.mockReset();
    mocks.saveConfig.mockResolvedValue(null);
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    mocks.workspaceContext = workspaceContext;
    mocks.teamStructure = getTeamStructure({ teamId: 'duo' });
  });

  it('applies both roles top favourites from the sidebar toolbar', async () => {
    mocks.teamStructure = seedTeam('duo', {
      planner: [{ agentHarness: 'claude', model: 'opus' }],
      builder: [{ agentHarness: 'opencode', model: 'gpt-5' }],
    });

    renderPanel();

    const group = screen.getByTestId('agent-team-actions');
    expect(within(group).getByRole('button', { name: 'Start agents' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Stop agents' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Restart agents' })).toBeInTheDocument();
    const apply = within(group).getByRole('button', { name: 'Apply top favourite models' });
    expect(apply).toBeEnabled();

    fireEvent.click(apply);

    await waitFor(() => expect(mocks.saveConfig).toHaveBeenCalledTimes(2));
    expect(mocks.saveConfig).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      workspaceId: 'ws-1',
      role: 'planner',
      machineId: 'm1',
      agentHarness: 'claude',
      model: 'opus',
      workingDir: '/repo',
    });
    expect(mocks.saveConfig).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      workspaceId: 'ws-1',
      role: 'builder',
      machineId: 'm1',
      agentHarness: 'opencode',
      model: 'gpt-5',
      workingDir: '/repo',
    });
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        'Applied top favourite model to 2 agent(s). Restart agents to use it.'
      )
    );
  });

  it('disables the apply button when no role has a favourite but leaves quick actions alone', async () => {
    seedTeam('duo', {});

    renderPanel();

    const group = screen.getByTestId('agent-team-actions');
    expect(
      within(group).getByRole('button', { name: 'Apply top favourite models' })
    ).toBeDisabled();
    expect(within(group).getByRole('button', { name: 'Start agents' })).toBeEnabled();

    fireEvent.click(within(group).getByRole('button', { name: 'Apply top favourite models' }));

    expect(mocks.saveConfig).not.toHaveBeenCalled();
  });
});
