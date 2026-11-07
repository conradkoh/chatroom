import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getTeamStructure } from '@workspace/shared/domain/team-presets';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplyTopFavoriteModelsButton } from './ApplyTopFavoriteModelsButton';

const mocks = vi.hoisted(() => ({
  /** Key: `${machineId}|${teamRoleKey}`. `undefined` means the query is still loading. */
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

vi.mock('../../../context/ChatroomWorkspaceContext', () => ({
  useChatroomWorkspace: () => mocks.workspaceContext,
}));

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
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

const NO_FAVORITES_REASON =
  "No favourite models for this team on this machine. Star a model in an agent's model picker first.";

/** Seeds an empty favourites list for every role of the team, then applies overrides. */
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

describe('ApplyTopFavoriteModelsButton', () => {
  beforeEach(() => {
    mocks.favoritesByKey = {};
    mocks.saveConfig.mockReset();
    mocks.saveConfig.mockResolvedValue(null);
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    mocks.workspaceContext = workspaceContext;
    mocks.teamStructure = getTeamStructure({ teamId: 'duo' });
  });

  it('applies both roles top favourites from the labelled button', async () => {
    mocks.teamStructure = seedTeam('duo', {
      planner: [{ agentHarness: 'claude', model: 'opus' }],
      builder: [{ agentHarness: 'opencode', model: 'gpt-5' }],
    });

    render(<ApplyTopFavoriteModelsButton variant="labelled" />);

    const button = screen.getByRole('button', { name: 'Apply top favourites' });
    expect(button).toBeEnabled();

    fireEvent.click(button);

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

  it('applies the same top favourites from the icon button', async () => {
    mocks.teamStructure = seedTeam('duo', {
      planner: [{ agentHarness: 'claude', model: 'opus' }],
      builder: [{ agentHarness: 'opencode', model: 'gpt-5' }],
    });

    render(<ApplyTopFavoriteModelsButton variant="icon" />);

    const button = screen.getByRole('button', { name: 'Apply top favourite models' });
    expect(button).toBeEnabled();

    fireEvent.click(button);

    await waitFor(() => expect(mocks.saveConfig).toHaveBeenCalledTimes(2));
    expect(mocks.saveConfig.mock.calls.map(([args]) => args.role)).toEqual(['planner', 'builder']);
    expect(mocks.saveConfig.mock.calls.map(([args]) => args.model)).toEqual(['opus', 'gpt-5']);
  });

  it('is disabled with a visible reason when no role has a favourite', async () => {
    seedTeam('duo', {});

    render(<ApplyTopFavoriteModelsButton variant="labelled" />);

    const button = screen.getByRole('button', { name: 'Apply top favourites' });
    expect(button).toBeDisabled();
    expect(screen.getByText(NO_FAVORITES_REASON)).toBeInTheDocument();

    fireEvent.click(button);

    expect(mocks.saveConfig).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('shows the applying state and ignores a second click until the save resolves', async () => {
    mocks.teamStructure = seedTeam('duo', {
      planner: [{ agentHarness: 'claude', model: 'opus' }],
      builder: [{ agentHarness: 'opencode', model: 'gpt-5' }],
    });
    const resolvers: ((value: null) => void)[] = [];
    mocks.saveConfig.mockImplementation(
      () =>
        new Promise<null>((resolve) => {
          resolvers.push(resolve);
        })
    );

    render(<ApplyTopFavoriteModelsButton variant="labelled" />);

    fireEvent.click(screen.getByRole('button', { name: 'Apply top favourites' }));

    const applying = screen.getByRole('button', { name: 'Applying…' });
    expect(applying).toBeDisabled();
    expect(applying).toHaveAttribute('aria-busy', 'true');
    expect(mocks.saveConfig).toHaveBeenCalledTimes(2);

    fireEvent.click(applying);
    expect(mocks.saveConfig).toHaveBeenCalledTimes(2);

    await waitFor(() => expect(resolvers).toHaveLength(2));
    resolvers.forEach((resolve) => resolve(null));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Apply top favourites' })).toBeEnabled()
    );
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        'Applied top favourite model to 2 agent(s). Restart agents to use it.'
      )
    );
  });

  it('reports a partial failure through the error toast', async () => {
    mocks.teamStructure = seedTeam('duo', {
      planner: [{ agentHarness: 'claude', model: 'opus' }],
      builder: [{ agentHarness: 'opencode', model: 'gpt-5' }],
    });
    mocks.saveConfig.mockImplementation((args: { role: string }) =>
      args.role === 'planner' ? Promise.reject(new Error('harness missing')) : Promise.resolve(null)
    );

    render(<ApplyTopFavoriteModelsButton variant="labelled" />);

    fireEvent.click(screen.getByRole('button', { name: 'Apply top favourites' }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        'Failed to apply top favourite model for planner (harness missing). Applied to 1 other agent(s).'
      )
    );
  });

  it('is disabled with the no-workspace reason when there is no active workspace', () => {
    mocks.workspaceContext = { ...workspaceContext, activeWorkspace: null, workspaces: [] };

    render(<ApplyTopFavoriteModelsButton variant="labelled" />);

    expect(screen.getByRole('button', { name: 'Apply top favourites' })).toBeDisabled();
    expect(screen.getByText('No active workspace')).toBeInTheDocument();
  });

  it('re-keys to the new team roles after a team switch', async () => {
    mocks.teamStructure = seedTeam('duo', {
      planner: [{ agentHarness: 'claude', model: 'opus' }],
      builder: [{ agentHarness: 'opencode', model: 'gpt-5' }],
    });

    const { rerender } = render(<ApplyTopFavoriteModelsButton variant="labelled" />);
    expect(screen.getByRole('button', { name: 'Apply top favourites' })).toBeEnabled();

    mocks.teamStructure = seedTeam('solo', {
      solo: [{ agentHarness: 'claude', model: 'sonnet' }],
    });
    rerender(<ApplyTopFavoriteModelsButton variant="labelled" />);

    fireEvent.click(screen.getByRole('button', { name: 'Apply top favourites' }));

    await waitFor(() => expect(mocks.saveConfig).toHaveBeenCalledTimes(1));
    expect(mocks.saveConfig).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      workspaceId: 'ws-1',
      role: 'solo',
      machineId: 'm1',
      agentHarness: 'claude',
      model: 'sonnet',
      workingDir: '/repo',
    });
    expect(mocks.saveConfig.mock.calls.map(([args]) => args.role)).not.toContain('planner');
    expect(mocks.saveConfig.mock.calls.map(([args]) => args.role)).not.toContain('builder');
  });
});
