import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentSettingsModal } from './AgentSettingsModal';

const mocks = vi.hoisted(() => ({
  useAgentPanelData: vi.fn(),
  useChatroomWorkspace: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: () => undefined,
  useSessionMutation: () => vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    chatrooms: { updateTeam: 'chatrooms.updateTeam' },
    workspaces: {
      setFileTreeSyncEnabled: 'workspaces.setFileTreeSyncEnabled',
      setPrimaryWorkspaceForChatroom: 'workspaces.setPrimaryWorkspaceForChatroom',
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

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
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
vi.mock('./picker', () => ({
  ResponsivePickerShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PickerScrollBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PickerOptionRow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
  Switch: () => <input type="checkbox" role="switch" />,
}));

/** The tab body is stubbed: this test only covers registration and mounting. */
vi.mock('./custom-agents/CustomAgentsTab', () => ({
  CustomAgentsTab: ({ onOpenTab }: { chatroomId: string; onOpenTab: (tab: string) => void }) => (
    <div data-testid="custom-agents-tab-stub">
      <button onClick={() => onOpenTab('team')}>stub-open-team</button>
    </div>
  ),
}));

const CHATROOM_ID = 'jd7testchatroom0000000000000002';

function renderModal(initialTab?: 'custom-agents' | 'setup') {
  return render(
    <AgentSettingsModal
      isOpen
      onClose={vi.fn()}
      chatroomId={CHATROOM_ID}
      currentTeamId={null}
      currentTeamRoles={[]}
      {...(initialTab === undefined ? {} : { initialTab })}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useAgentPanelData.mockReturnValue({ machineConfigs: [] });
  mocks.useChatroomWorkspace.mockReturnValue({
    workspaces: [],
    activeWorkspace: null,
    isLoading: false,
    setPrimaryWorkspace: vi.fn(),
    removeWorkspace: vi.fn(),
  });
});

describe('AgentSettingsModal custom agents tab', () => {
  it('lists Custom Agents directly after Agents', () => {
    renderModal();

    const labels = screen.getAllByRole('button').map((button) => button.textContent?.trim());
    const agentsIndex = labels.indexOf('Agents');
    expect(agentsIndex).toBeGreaterThanOrEqual(0);
    expect(labels[agentsIndex + 1]).toBe('Custom Agents');
  });

  it('renders the Custom Agents body and title for initialTab', () => {
    renderModal('custom-agents');

    expect(screen.getByTestId('custom-agents-tab-stub')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Custom Agents' })).toBeInTheDocument();
  });

  it('unmounts the tab body when another tab is selected', () => {
    renderModal('custom-agents');

    fireEvent.click(screen.getByRole('button', { name: 'Setup' }));

    expect(screen.queryByTestId('custom-agents-tab-stub')).not.toBeInTheDocument();
  });

  it('switches to the Team tab through the onOpenTab callback', () => {
    renderModal('custom-agents');

    fireEvent.click(screen.getByRole('button', { name: 'stub-open-team' }));

    expect(screen.getByRole('heading', { name: 'Team' })).toBeInTheDocument();
    expect(screen.queryByTestId('custom-agents-tab-stub')).not.toBeInTheDocument();
  });
});
