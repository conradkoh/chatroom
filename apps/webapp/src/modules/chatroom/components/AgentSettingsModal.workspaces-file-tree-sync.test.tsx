import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentSettingsModal } from './AgentSettingsModal';
import type { Workspace } from '../types/workspace';

const mocks = vi.hoisted(() => ({
  useAgentPanelData: vi.fn(),
  useChatroomWorkspaces: vi.fn(),
  setFileTreeSyncEnabled: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: () => undefined,
  useSessionMutation: (mutation: unknown) => {
    const name = String(mutation).split('.').pop();
    if (name === 'setFileTreeSyncEnabled') return mocks.setFileTreeSyncEnabled;
    return vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    workspaces: {
      setFileTreeSyncEnabled: 'workspaces.setFileTreeSyncEnabled',
      removeWorkspace: 'workspaces.removeWorkspace',
      purgeFullDiffV2: 'workspaces.purgeFullDiffV2',
      purgeCommitDetailV2: 'workspaces.purgeCommitDetailV2',
    },
    workspaceFiles: {
      purgeFileTreeV2: 'workspaceFiles.purgeFileTreeV2',
      purgeFileContentV2: 'workspaceFiles.purgeFileContentV2',
      requestFileTree: 'workspaceFiles.requestFileTree',
    },
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: mocks.toastError },
}));

vi.mock('../hooks/useAgentPanelData', () => ({
  useAgentPanelData: (...args: unknown[]) => mocks.useAgentPanelData(...args),
}));

vi.mock('../workspace/hooks/useChatroomWorkspaces', () => ({
  useChatroomWorkspaces: (...args: unknown[]) => mocks.useChatroomWorkspaces(...args),
}));

vi.mock('../workspace/hooks/useClearWorkspaceFileTree', () => ({
  useClearWorkspaceFileTree: () => vi.fn(),
}));

vi.mock('../hooks/use-team-configs', () => ({
  useTeamConfigs: () => ({ teams: [], defaultTeamId: undefined, getById: () => undefined }),
}));

// Light mocks for tab content that is out of scope for these tests.
vi.mock('./AgentPanel/InlineAgentListPanel', () => ({ InlineAgentListPanel: () => null }));
vi.mock('./AgentPanel/useInlineAgentList', () => ({
  useInlineAgentList: () => ({ onlineCount: 0, totalCount: 0 }),
}));
vi.mock('./CopyButton', () => ({ CopyButton: () => null }));
vi.mock('./IntegrationsTab', () => ({ IntegrationsTab: () => null }));
vi.mock('./LifecycleConfirmDialog', () => ({ LifecycleConfirmDialog: () => null }));
vi.mock('./SkillsTab', () => ({ SkillsTab: () => null }));
vi.mock('./picker', () => ({
  ResponsivePickerShell: () => null,
  PickerScrollBody: () => null,
  PickerOptionRow: () => null,
}));
vi.mock('./ui/ChatroomDestructiveTextButton', () => ({
  ChatroomDestructiveTextButton: () => null,
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
  Switch: ({
    checked,
    onCheckedChange,
    disabled,
    id,
    'aria-label': ariaLabel,
  }: {
    checked: boolean;
    onCheckedChange?: (checked: boolean) => void;
    disabled?: boolean;
    id?: string;
    'aria-label'?: string;
  }) => (
    <input
      type="checkbox"
      role="switch"
      id={id}
      aria-label={ariaLabel}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
    />
  ),
}));

const CHATROOM_ID = 'jd7testchatroom0000000000000001';

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'm1::/repo',
    machineId: 'm1',
    hostname: 'host-a',
    workingDir: '/repo',
    agentRoles: [],
    registeredAt: 1,
    _registryId: 'registry-1',
    fileTreeSyncEnabled: false,
    ...overrides,
  };
}

function renderModal() {
  return render(
    <AgentSettingsModal isOpen onClose={vi.fn()} chatroomId={CHATROOM_ID} initialTab="workspaces" />
  );
}

function mockWorkspaces(workspaces: Workspace[]) {
  mocks.useChatroomWorkspaces.mockReturnValue({
    workspaces,
    isLoading: false,
    removeWorkspace: vi.fn(),
  });
}

describe('AgentSettingsModal workspaces file-tree sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setFileTreeSyncEnabled.mockResolvedValue(undefined);
    mocks.useAgentPanelData.mockReturnValue({ machineConfigs: [] });
  });

  it('renders the sync switch unchecked when fileTreeSyncEnabled is false', () => {
    mockWorkspaces([makeWorkspace({ fileTreeSyncEnabled: false })]);

    renderModal();

    const sw = screen.getByRole('switch', { name: 'Sync file tree for host-a' });
    expect(sw).not.toBeChecked();
  });

  it('renders the sync switch checked when fileTreeSyncEnabled is true', () => {
    mockWorkspaces([makeWorkspace({ fileTreeSyncEnabled: true })]);

    renderModal();

    const sw = screen.getByRole('switch', { name: 'Sync file tree for host-a' });
    expect(sw).toBeChecked();
  });

  it('renders an independent switch per workspace card', () => {
    mockWorkspaces([
      makeWorkspace({
        id: 'm1::/a',
        workingDir: '/a',
        hostname: 'host-a',
        fileTreeSyncEnabled: false,
      }),
      makeWorkspace({
        id: 'm1::/b',
        workingDir: '/b',
        hostname: 'host-b',
        fileTreeSyncEnabled: true,
      }),
    ]);

    renderModal();

    expect(screen.getByRole('switch', { name: 'Sync file tree for host-a' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Sync file tree for host-b' })).toBeChecked();
  });

  it('calls setFileTreeSyncEnabled with the workspace registry id when enabling', async () => {
    mockWorkspaces([makeWorkspace({ fileTreeSyncEnabled: false })]);

    renderModal();

    fireEvent.click(screen.getByRole('switch', { name: 'Sync file tree for host-a' }));

    await waitFor(() => {
      expect(mocks.setFileTreeSyncEnabled).toHaveBeenCalledWith({
        workspaceId: 'registry-1',
        enabled: true,
      });
    });
  });

  it('calls setFileTreeSyncEnabled with the workspace registry id when disabling', async () => {
    mockWorkspaces([makeWorkspace({ fileTreeSyncEnabled: true })]);

    renderModal();

    fireEvent.click(screen.getByRole('switch', { name: 'Sync file tree for host-a' }));

    await waitFor(() => {
      expect(mocks.setFileTreeSyncEnabled).toHaveBeenCalledWith({
        workspaceId: 'registry-1',
        enabled: false,
      });
    });
  });

  it('shows an error toast when the mutation fails', async () => {
    mockWorkspaces([makeWorkspace({ fileTreeSyncEnabled: false })]);
    mocks.setFileTreeSyncEnabled.mockRejectedValueOnce(new Error('boom'));

    renderModal();

    fireEvent.click(screen.getByRole('switch', { name: 'Sync file tree for host-a' }));

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Failed to enable workspace file tree sync');
    });
  });

  it('disables the switch and shows Enabling… text while the mutation is pending', async () => {
    mockWorkspaces([makeWorkspace({ fileTreeSyncEnabled: false })]);
    mocks.setFileTreeSyncEnabled.mockReturnValueOnce(new Promise(() => {}));

    renderModal();

    fireEvent.click(screen.getByRole('switch', { name: 'Sync file tree for host-a' }));

    expect(await screen.findByText('Enabling…')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Sync file tree for host-a' })).toBeDisabled();
  });

  it('disables the switch and shows Disabling… text while the mutation is pending', async () => {
    mockWorkspaces([makeWorkspace({ fileTreeSyncEnabled: true })]);
    mocks.setFileTreeSyncEnabled.mockReturnValueOnce(new Promise(() => {}));

    renderModal();

    fireEvent.click(screen.getByRole('switch', { name: 'Sync file tree for host-a' }));

    expect(await screen.findByText('Disabling…')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Sync file tree for host-a' })).toBeDisabled();
  });
});
