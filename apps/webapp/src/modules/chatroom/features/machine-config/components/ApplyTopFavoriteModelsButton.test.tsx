import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getTeamStructure } from '@workspace/shared/domain/team-presets';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplyTopFavoriteModelsButton } from './ApplyTopFavoriteModelsButton';

const mocks = vi.hoisted(() => ({
  /** Key: `${machineId}|${teamRoleKey}`. `undefined` means the query is still loading. */
  favoritesByKey: {} as Record<string, { agentHarness: string; model: string }[] | undefined>,
  applyConfig: vi.fn(),
  saveConfig: vi.fn(),
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
  useSessionMutation: (ref: unknown) =>
    ref === 'agents:applyConfig' ? mocks.applyConfig : mocks.saveConfig,
  useSessionQuery: (ref: unknown) =>
    ref === 'chatrooms:getTeamStructureForChatroom' ? mocks.teamStructure : undefined,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    machineConfigFavorites: {
      getMachineConfigFavorites: 'machineConfigFavorites:getMachineConfigFavorites',
    },
    agents: { applyConfig: 'agents:applyConfig', saveConfig: 'agents:saveConfig' },
    chatrooms: { getTeamStructureForChatroom: 'chatrooms:getTeamStructureForChatroom' },
    machines: { listMachines: 'machines:listMachines' },
  },
}));

vi.mock('../../../context/ChatroomWorkspaceContext', () => ({
  useChatroomWorkspace: () => mocks.workspaceContext,
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
    mocks.applyConfig.mockReset();
    mocks.saveConfig.mockReset();
    mocks.applyConfig.mockResolvedValue({ outcome: 'restarted' });
    mocks.workspaceContext = workspaceContext;
    mocks.teamStructure = getTeamStructure({ teamId: 'duo' });
  });

  it('applies both roles top favourites from the labelled button', async () => {
    mocks.teamStructure = seedTeam('duo', {
      planner: [{ agentHarness: 'claude-sdk', model: 'opus' }],
      builder: [{ agentHarness: 'opencode-sdk', model: 'gpt-5' }],
    });

    render(<ApplyTopFavoriteModelsButton variant="labelled" />);

    const button = screen.getByRole('button', { name: 'Apply top favourites' });
    expect(button).toBeEnabled();

    fireEvent.click(button);

    await waitFor(() => expect(mocks.applyConfig).toHaveBeenCalledTimes(2));
    expect(mocks.applyConfig).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      workspaceId: 'ws-1',
      role: 'planner',
      agentHarness: 'claude-sdk',
      model: 'opus',
    });
    expect(mocks.applyConfig).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      workspaceId: 'ws-1',
      role: 'builder',
      agentHarness: 'opencode-sdk',
      model: 'gpt-5',
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Applied top favourite model to 2 agent(s): 2 restarted.'
    );
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('2 restarted.'));
  });

  it('applies the same top favourites from the icon button', async () => {
    mocks.teamStructure = seedTeam('duo', {
      planner: [{ agentHarness: 'claude-sdk', model: 'opus' }],
      builder: [{ agentHarness: 'opencode-sdk', model: 'gpt-5' }],
    });

    render(<ApplyTopFavoriteModelsButton variant="icon" onFeedbackChange={vi.fn()} />);

    const button = screen.getByRole('button', { name: 'Apply top favourite models' });
    expect(button).toBeEnabled();

    fireEvent.click(button);

    await waitFor(() => expect(mocks.applyConfig).toHaveBeenCalledTimes(2));
    expect(mocks.applyConfig.mock.calls.map(([args]) => args.role)).toEqual(['planner', 'builder']);
    expect(mocks.applyConfig.mock.calls.map(([args]) => args.model)).toEqual(['opus', 'gpt-5']);
  });

  it('is disabled with a visible reason when no role has a favourite', async () => {
    seedTeam('duo', {});

    render(<ApplyTopFavoriteModelsButton variant="labelled" />);

    const button = screen.getByRole('button', { name: 'Apply top favourites' });
    expect(button).toBeDisabled();
    expect(screen.getByText(NO_FAVORITES_REASON)).toBeInTheDocument();

    fireEvent.click(button);

    expect(mocks.applyConfig).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the applying state and ignores a second click until the save resolves', async () => {
    mocks.teamStructure = seedTeam('duo', {
      planner: [{ agentHarness: 'claude-sdk', model: 'opus' }],
      builder: [{ agentHarness: 'opencode-sdk', model: 'gpt-5' }],
    });
    const resolvers: ((value: { outcome: 'restarted' }) => void)[] = [];
    mocks.applyConfig.mockImplementation(
      () =>
        new Promise<{ outcome: 'restarted' }>((resolve) => {
          resolvers.push(resolve);
        })
    );

    render(<ApplyTopFavoriteModelsButton variant="labelled" />);

    fireEvent.click(screen.getByRole('button', { name: 'Apply top favourites' }));

    const applying = screen.getByRole('button', { name: 'Applying…' });
    expect(applying).toBeDisabled();
    expect(applying).toHaveAttribute('aria-busy', 'true');
    expect(mocks.applyConfig).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('status')).toBeNull();

    fireEvent.click(applying);
    expect(mocks.applyConfig).toHaveBeenCalledTimes(2);

    await waitFor(() => expect(resolvers).toHaveLength(2));
    resolvers.forEach((resolve) => resolve({ outcome: 'restarted' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Apply top favourites' })).toBeEnabled()
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Applied top favourite model to 2 agent(s): 2 restarted.'
    );
  });

  it('shows a partial failure as an inline alert that stays until the next apply', async () => {
    mocks.teamStructure = seedTeam('duo', {
      planner: [{ agentHarness: 'claude-sdk', model: 'opus' }],
      builder: [{ agentHarness: 'opencode-sdk', model: 'gpt-5' }],
    });
    mocks.applyConfig.mockImplementation((args: { role: string }) =>
      args.role === 'planner'
        ? Promise.reject(new Error('harness missing'))
        : Promise.resolve({ outcome: 'restarted' })
    );

    render(<ApplyTopFavoriteModelsButton variant="labelled" />);

    fireEvent.click(screen.getByRole('button', { name: 'Apply top favourites' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to apply top favourite model for planner (harness missing). Applied to 1 other agent(s): 1 restarted.'
    );
  });

  it('clears the previous outcome when the next apply starts', async () => {
    mocks.teamStructure = seedTeam('duo', {
      planner: [{ agentHarness: 'claude-sdk', model: 'opus' }],
      builder: [{ agentHarness: 'opencode-sdk', model: 'gpt-5' }],
    });

    render(<ApplyTopFavoriteModelsButton variant="labelled" />);

    fireEvent.click(screen.getByRole('button', { name: 'Apply top favourites' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Applied top favourite model to 2 agent(s): 2 restarted.'
    );

    // The second apply never resolves, so the cleared hint is observable while it is in flight.
    mocks.applyConfig.mockImplementation(() => new Promise(() => {}));

    fireEvent.click(screen.getByRole('button', { name: 'Apply top favourites' }));

    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('publishes the icon outcome to the caller and renders no inline text', async () => {
    mocks.teamStructure = seedTeam('duo', {
      planner: [{ agentHarness: 'claude-sdk', model: 'opus' }],
      builder: [{ agentHarness: 'opencode-sdk', model: 'gpt-5' }],
    });
    mocks.applyConfig.mockImplementation((args: { role: string }) =>
      args.role === 'planner'
        ? Promise.reject(new Error('harness missing'))
        : Promise.resolve({ outcome: 'restarted' })
    );
    const onFeedbackChange = vi.fn();

    const { container } = render(
      <ApplyTopFavoriteModelsButton variant="icon" onFeedbackChange={onFeedbackChange} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Apply top favourite models' }));

    await waitFor(() =>
      expect(onFeedbackChange).toHaveBeenLastCalledWith({
        kind: 'error',
        message:
          'Failed to apply top favourite model for planner (harness missing). Applied to 1 other agent(s): 1 restarted.',
      })
    );
    expect(onFeedbackChange).toHaveBeenNthCalledWith(1, null);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('is disabled with the no-workspace reason when there is no active workspace', () => {
    mocks.workspaceContext = { ...workspaceContext, activeWorkspace: null, workspaces: [] };

    render(<ApplyTopFavoriteModelsButton variant="labelled" />);

    expect(screen.getByRole('button', { name: 'Apply top favourites' })).toBeDisabled();
    expect(screen.getByText('No active workspace')).toBeInTheDocument();
  });

  it('re-keys to the new team roles after a team switch', async () => {
    mocks.teamStructure = seedTeam('duo', {
      planner: [{ agentHarness: 'claude-sdk', model: 'opus' }],
      builder: [{ agentHarness: 'opencode-sdk', model: 'gpt-5' }],
    });

    const { rerender } = render(<ApplyTopFavoriteModelsButton variant="labelled" />);
    expect(screen.getByRole('button', { name: 'Apply top favourites' })).toBeEnabled();

    mocks.teamStructure = seedTeam('solo', {
      solo: [{ agentHarness: 'claude-sdk', model: 'sonnet' }],
    });
    rerender(<ApplyTopFavoriteModelsButton variant="labelled" />);

    fireEvent.click(screen.getByRole('button', { name: 'Apply top favourites' }));

    await waitFor(() => expect(mocks.applyConfig).toHaveBeenCalledTimes(1));
    expect(mocks.applyConfig).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      workspaceId: 'ws-1',
      role: 'solo',
      agentHarness: 'claude-sdk',
      model: 'sonnet',
    });
    expect(mocks.applyConfig.mock.calls.map(([args]) => args.role)).not.toContain('planner');
    expect(mocks.applyConfig.mock.calls.map(([args]) => args.role)).not.toContain('builder');
  });
});
