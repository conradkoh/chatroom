import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentSettingsModal } from './AgentSettingsModal';

const mocks = vi.hoisted(() => ({
  genericMutation: vi.fn(),
  onClose: vi.fn(),
}));

vi.mock('convex/react', () => ({
  useQueries: () => ({}),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-1'],
  useSessionQuery: () => undefined,
  useSessionMutation: () => mocks.genericMutation,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    agents: { saveConfig: 'agents:saveConfig' },
    chatrooms: {
      getTeamStructureForChatroom: 'chatrooms:getTeamStructureForChatroom',
      updateTeam: 'chatrooms:updateTeam',
    },
    machines: { listMachines: 'machines:listMachines' },
    workspaces: {
      setFileTreeSyncEnabled: 'workspaces:setFileTreeSyncEnabled',
      setPrimaryWorkspaceForChatroom: 'workspaces:setPrimaryWorkspaceForChatroom',
      removeWorkspace: 'workspaces:removeWorkspace',
      getPrimaryWorkspaceForChatroom: 'workspaces:getPrimaryWorkspaceForChatroom',
    },
    daemon: {
      machineCommandInbox: {
        list: 'daemon:machineCommandInbox:list',
        deleteCommand: 'daemon:machineCommandInbox:deleteCommand',
        deleteAll: 'daemon:machineCommandInbox:deleteAll',
      },
    },
  },
}));

vi.mock('../hooks/useAgentPanelData', () => ({
  useAgentPanelData: () => ({ machineConfigs: [] }),
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
// The shell only wraps the trigger in a popover/drawer; rendering the trigger
// directly is enough to assert its contents.
vi.mock('./picker', () => ({
  ResponsivePickerShell: ({ trigger }: { trigger: React.ReactNode }) => <>{trigger}</>,
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

describe('AgentSettingsModal mobile tab trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the active tab label with an icon and a chevron', () => {
    render(
      <AgentSettingsModal
        isOpen
        onClose={mocks.onClose}
        chatroomId="room-1"
        currentTeamId={null}
        currentTeamRoles={[]}
        initialTab="integrations"
      />
    );

    const trigger = screen.getByTestId('settings-mobile-tab-trigger');

    expect(trigger).toHaveAccessibleName('Integrations');
    // Two icons: the tab icon (leading) and the chevron (trailing).
    expect(trigger.querySelectorAll('svg')).toHaveLength(2);
  });
});
