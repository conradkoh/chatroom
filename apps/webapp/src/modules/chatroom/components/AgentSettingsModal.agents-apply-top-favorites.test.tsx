import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getTeamStructure } from '@workspace/shared/domain/team-presets';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentSettingsModal } from './AgentSettingsModal';

const mocks = vi.hoisted(() => ({
  favoritesByKey: {} as Record<string, { agentHarness: string; model: string }[] | undefined>,
  saveConfig: vi.fn(),
  genericMutation: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  teamStructure: undefined as unknown,
  workspaceContext: null as unknown,
  useAgentPanelData: vi.fn(),
  useChatroomWorkspace: vi.fn(),
  setPrimaryWorkspace: vi.fn(),
  removeWorkspace: vi.fn(),
  onClose: vi.fn(),
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
  useSessionQuery: (ref: unknown) =>
    String(ref).includes('getTeamStructureForChatroom') ? mocks.teamStructure : undefined,
  useSessionMutation: (ref: unknown) =>
    String(ref).includes('saveConfig') ? mocks.saveConfig : mocks.genericMutation,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    machineConfigFavorites: {
      getMachineConfigFavorites: 'machineConfigFavorites:getMachineConfigFavorites',
    },
    agents: { saveConfig: 'agents:saveConfig' },
    chatrooms: {
      getTeamStructureForChatroom: 'chatrooms:getTeamStructureForChatroom',
      updateTeam: 'chatrooms:updateTeam',
    },
    machines: {
      listMachines: 'machines:listMachines',
      setMachineAlias: 'machines:setMachineAlias',
    },
    workspaces: {
      setFileTreeSyncEnabled: 'workspaces:setFileTreeSyncEnabled',
      setPrimaryWorkspaceForChatroom: 'workspaces:setPrimaryWorkspaceForChatroom',
      removeWorkspace: 'workspaces:removeWorkspace',
      purgeFullDiffV2: 'workspaces:purgeFullDiffV2',
      purgeCommitDetailV2: 'workspaces:purgeCommitDetailV2',
      getPrimaryWorkspaceForChatroom: 'workspaces:getPrimaryWorkspaceForChatroom',
    },
    workspaceFiles: {
      purgeFileTreeV2: 'workspaceFiles:purgeFileTreeV2',
      purgeFileContentV2: 'workspaceFiles:purgeFileContentV2',
      requestFileTree: 'workspaceFiles:requestFileTree',
    },
    daemon: {
      machineCommandInbox: {
        list: 'daemon:machineCommandInbox:list',
        deleteCommand: 'daemon:machineCommandInbox:deleteCommand',
        deleteAll: 'daemon:machineCommandInbox:deleteAll',
      },
    },
    agentWorkspaces: {
      getAgentStatusForWorkspaceRole: 'agentWorkspaces:getAgentStatusForWorkspaceRole',
      getAgentConfigForWorkspaceRole: 'agentWorkspaces:getAgentConfigForWorkspaceRole',
    },
  },
}));

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock('../hooks/useAgentPanelData', () => ({
  useAgentPanelData: (...args: unknown[]) => mocks.useAgentPanelData(...args),
}));

vi.mock('../context/ChatroomWorkspaceContext', () => ({
  useChatroomWorkspace: (...args: unknown[]) => mocks.useChatroomWorkspace(...args),
}));

vi.mock('../workspace/hooks/useClearWorkspaceFileTree', () => ({
  useClearWorkspaceFileTree: () => vi.fn(),
}));

vi.mock('../hooks/use-team-configs', () => ({
  useTeamConfigs: () => ({ teams: [], defaultTeamId: undefined, getById: () => undefined }),
}));

vi.mock('./AgentPanel/WorkspaceInlineAgentListPanel', () => ({
  WorkspaceInlineAgentListPanel: () => null,
}));
vi.mock('./CopyButton', () => ({ CopyButton: () => null }));
vi.mock('./IntegrationsTab', () => ({ IntegrationsTab: () => null }));
vi.mock('./LifecycleConfirmDialog', () => ({ LifecycleConfirmDialog: () => null }));
vi.mock('./SkillsTab', () => ({ SkillsTab: () => null }));
vi.mock('@/modules/chatroom/features/file-attachments/components/FileStoragePanel', () => ({
  FileStoragePanel: () => null,
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('./picker', () => ({
  ResponsivePickerShell: () => null,
  PickerScrollBody: () => null,
  PickerOptionRow: () => null,
}));
vi.mock('@/components/ui/fixed-modal', () => ({
  FixedModal: ({ children, isOpen }: { children: React.ReactNode; isOpen: boolean }) =>
    isOpen ? <div data-testid="fixed-modal">{children}</div> : null,
  FixedModalContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FixedModalHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FixedModalTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  FixedModalSidebar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FixedModalBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/ui/switch', () => ({
  Switch: () => null,
}));

const activeWorkspace = {
  id: 'm1::/repo',
  machineId: 'm1',
  hostname: 'host-a',
  workingDir: '/repo',
  agentRoles: [],
  _registryId: 'ws-1',
  registeredAt: 1,
  fileTreeSyncEnabled: false,
};

const NO_FAVORITES_REASON =
  "No favourite models for this team on this machine. Star a model in an agent's model picker first.";

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

function mockContexts() {
  mocks.useChatroomWorkspace.mockReturnValue({
    chatroomId: 'room-1',
    workspaces: [activeWorkspace],
    activeWorkspace,
    isLoading: false,
    setPrimaryWorkspace: mocks.setPrimaryWorkspace,
    removeWorkspace: mocks.removeWorkspace,
  });
  mocks.useAgentPanelData.mockReturnValue({ machineConfigs: [] });
}

function renderAgentsTab(onClose: (...args: unknown[]) => void) {
  return render(
    <AgentSettingsModal
      isOpen
      onClose={onClose as () => void}
      chatroomId="room-1"
      currentTeamId={null}
      currentTeamRoles={[]}
      initialTab="agents"
    />
  );
}

describe('AgentSettingsModal agents apply top favourites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.favoritesByKey = {};
    mocks.saveConfig.mockResolvedValue(null);
    mocks.genericMutation.mockResolvedValue(undefined);
    mocks.teamStructure = getTeamStructure({ teamId: 'duo' });
    mocks.onClose = vi.fn();
    mockContexts();
  });

  it('applies both roles top favourites from the Agents tab', async () => {
    mocks.teamStructure = seedTeam('duo', {
      planner: [{ agentHarness: 'claude', model: 'opus' }],
      builder: [{ agentHarness: 'opencode', model: 'gpt-5' }],
    });

    renderAgentsTab(mocks.onClose);

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

  it('disables the button and shows the empty reason when no role has a favourite', () => {
    seedTeam('duo', {});

    renderAgentsTab(mocks.onClose);

    expect(screen.getByRole('button', { name: 'Apply top favourites' })).toBeDisabled();
    expect(screen.getByText(NO_FAVORITES_REASON)).toBeInTheDocument();
  });

  it('re-keys to the solo team after a team switch', async () => {
    mocks.teamStructure = seedTeam('duo', {
      planner: [{ agentHarness: 'claude', model: 'opus' }],
      builder: [{ agentHarness: 'opencode', model: 'gpt-5' }],
    });

    const { rerender } = renderAgentsTab(mocks.onClose);
    expect(screen.getByRole('button', { name: 'Apply top favourites' })).toBeEnabled();

    mocks.teamStructure = seedTeam('solo', {
      solo: [{ agentHarness: 'claude', model: 'sonnet' }],
    });
    const nextOnClose = vi.fn();
    // AgentSettingsModal is memo'd AND the inner AgentsContent is memo'd on
    // chatroomId only, so a re-render with identical props bails out twice and
    // keeps the stale duo directory. Remount with a new key (plus a new onClose)
    // so the team switch is picked up; this documents the double-memo behaviour.
    rerender(
      <AgentSettingsModal
        key="solo-team"
        isOpen
        onClose={nextOnClose}
        chatroomId="room-1"
        currentTeamId={null}
        currentTeamRoles={[]}
        initialTab="agents"
      />
    );

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
  });
});
