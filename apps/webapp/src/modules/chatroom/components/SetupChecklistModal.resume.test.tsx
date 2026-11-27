import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SetupChecklistModal } from './SetupChecklistModal';

const mockUseChatroomWorkspaces = vi.fn();
const mockUseUserMachines = vi.fn();
const mockUseAgentConfigs = vi.fn();
const mockUseAgentCommandSender = vi.fn();
const mockUseDaemonConnectivity = vi.fn();
const mockSetupWorkspaceStep = vi.fn();
const mockUseChatroomWorkspace = vi.fn();
const mockUseSwitchWorkspaceFlow = vi.fn();
const mockRegisterWorkspace = vi.fn().mockResolvedValue(undefined);
const mockSwitchFlowStub = vi.fn();

vi.mock('../context/ChatroomWorkspaceContext', () => ({
  useChatroomWorkspace: () => mockUseChatroomWorkspace(),
}));

vi.mock('../features/switch-workspace/useSwitchWorkspaceFlow', () => ({
  useSwitchWorkspaceFlow: () => mockUseSwitchWorkspaceFlow(),
}));

vi.mock('../features/switch-workspace/SwitchWorkspaceFlow', () => ({
  SwitchWorkspaceFlow: (props: unknown) => {
    mockSwitchFlowStub(props);
    return <div data-testid="switch-workspace-flow" />;
  },
}));

vi.mock('../workspace/hooks/useChatroomWorkspaces', () => ({
  useChatroomWorkspaces: (...args: unknown[]) => mockUseChatroomWorkspaces(...args),
}));

vi.mock('../hooks/useAgentCommandSender', () => ({
  useAgentCommandSender: (...args: unknown[]) => mockUseAgentCommandSender(...args),
}));

vi.mock('../hooks/useAgentConfigs', () => ({
  useAgentConfigs: (...args: unknown[]) => mockUseAgentConfigs(...args),
}));

vi.mock('@/hooks/useUserMachines', () => ({
  useUserMachines: (...args: unknown[]) => mockUseUserMachines(...args),
}));

vi.mock('@/hooks/useDaemonConnectivity', () => ({
  useDaemonConnectivity: (...args: unknown[]) => mockUseDaemonConnectivity(...args),
}));

vi.mock('./setup/SetupWorkspaceStep', () => ({
  SetupWorkspaceStep: (props: unknown) => {
    mockSetupWorkspaceStep(props);
    return <div data-testid="setup-workspace-step" />;
  },
}));

vi.mock('./setup/SetupAgentTeamStep', () => ({
  SetupAgentTeamStep: (props: { onBack: () => void }) => (
    <div data-testid="setup-agent-team-step">
      <button type="button" onClick={props.onBack}>
        back
      </button>
    </div>
  ),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mockRegisterWorkspace,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    workspaces: { registerWorkspace: 'workspaces:registerWorkspace' },
  },
}));

vi.mock('@/components/ui/fixed-modal', () => ({
  FixedModal: ({ children, isOpen }: { children: React.ReactNode; isOpen: boolean }) =>
    isOpen ? <div data-testid="fixed-modal">{children}</div> : null,
  FixedModalContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FixedModalHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FixedModalTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  FixedModalBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const CHATROOM_ID = 'jd7testchatroom0000000000000001';

function modalElement(overrides?: Partial<React.ComponentProps<typeof SetupChecklistModal>>) {
  return (
    <SetupChecklistModal
      isOpen
      onClose={vi.fn()}
      chatroomId={CHATROOM_ID}
      teamRoles={['planner', 'builder']}
      participants={[]}
      chatroomName="Test"
      onRenameChatroom={vi.fn().mockResolvedValue(undefined)}
      {...overrides}
    />
  );
}

function renderModal(overrides?: Partial<React.ComponentProps<typeof SetupChecklistModal>>) {
  return render(modalElement(overrides));
}

describe('SetupChecklistModal resume', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDaemonConnectivity.mockReturnValue(new Map());
    mockUseUserMachines.mockReturnValue({
      machines: [],
      isLoading: false,
    });
    mockUseAgentConfigs.mockReturnValue({
      isLoading: false,
      configs: [],
    });
    mockUseAgentCommandSender.mockReturnValue(vi.fn());
    mockUseChatroomWorkspace.mockReturnValue({
      activeWorkspace: null,
      chatroomId: CHATROOM_ID,
      isLoading: false,
      workspaces: [],
      switchWorkspace: vi.fn(),
    });
    mockUseSwitchWorkspaceFlow.mockReturnValue({
      stage: 'choose',
      busy: false,
      error: null,
      result: null,
      stale: false,
      reset: vi.fn(),
    });
  });

  it('opens on agents step when a workspace is already registered', () => {
    mockUseChatroomWorkspaces.mockReturnValue({
      workspaces: [
        {
          id: 'm1::/code',
          machineId: 'm1',
          workingDir: '/code',
          hostname: 'dev',
          agentRoles: [],
          registeredAt: 200,
        },
      ],
      isLoading: false,
    });

    renderModal();
    expect(screen.getByTestId('setup-agent-team-step')).toBeInTheDocument();
    expect(screen.queryByTestId('setup-workspace-step')).not.toBeInTheDocument();
  });

  it('opens on workspace step when no registered workspace', () => {
    mockUseChatroomWorkspaces.mockReturnValue({
      workspaces: [],
      isLoading: false,
    });

    renderModal();
    expect(screen.getByTestId('setup-workspace-step')).toBeInTheDocument();
    expect(screen.queryByTestId('setup-agent-team-step')).not.toBeInTheDocument();
  });

  it('passes only connected machines to the workspace step', () => {
    const connectedMachine = {
      machineId: 'm1',
      hostname: 'connected-host',
      os: 'darwin',
      registeredAt: 1,
    };
    const offlineMachine = {
      machineId: 'm2',
      hostname: 'offline-host',
      os: 'darwin',
      registeredAt: 2,
    };
    mockUseUserMachines.mockReturnValue({
      machines: [connectedMachine, offlineMachine],
      isLoading: false,
    });
    mockUseDaemonConnectivity.mockReturnValue(
      new Map([
        ['m1', { connected: true }],
        ['m2', { connected: false }],
      ])
    );
    mockUseChatroomWorkspaces.mockReturnValue({ workspaces: [], isLoading: false });

    renderModal();

    expect(mockUseDaemonConnectivity).toHaveBeenCalledWith();
    expect(mockSetupWorkspaceStep).toHaveBeenCalledWith(
      expect.objectContaining({ connectedMachines: [connectedMachine] })
    );
  });

  it('does not subscribe to connectivity while the modal is closed', () => {
    mockUseChatroomWorkspaces.mockReturnValue({ workspaces: [], isLoading: false });

    renderModal({ isOpen: false });

    expect(mockUseDaemonConnectivity).not.toHaveBeenCalled();
  });

  it('does not flash workspace step while workspaces are loading', () => {
    mockUseChatroomWorkspaces.mockReturnValue({
      workspaces: [],
      isLoading: true,
    });

    renderModal();
    expect(screen.getByText('Loading workspace...')).toBeInTheDocument();
    expect(screen.queryByTestId('setup-workspace-step')).not.toBeInTheDocument();
    expect(screen.queryByTestId('setup-agent-team-step')).not.toBeInTheDocument();
  });

  it('shows the switch flow on Back for a bound chatroom and never registers', async () => {
    const boundWorkspace = {
      id: 'm1::/code',
      machineId: 'm1',
      workingDir: '/code',
      hostname: 'dev',
      agentRoles: [],
      registeredAt: 200,
    };
    mockUseChatroomWorkspaces.mockReturnValue({ workspaces: [boundWorkspace], isLoading: false });
    mockUseChatroomWorkspace.mockReturnValue({
      activeWorkspace: {
        ...boundWorkspace,
        machineAlias: undefined,
        fileTreeSyncEnabled: true,
        _registryId: 'ws_1',
      },
      chatroomId: CHATROOM_ID,
      isLoading: false,
      workspaces: [boundWorkspace],
      switchWorkspace: vi.fn(),
    });

    renderModal();
    expect(screen.getByTestId('setup-agent-team-step')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'back' }));

    expect(screen.getByTestId('switch-workspace-flow')).toBeInTheDocument();
    expect(screen.queryByTestId('setup-workspace-step')).not.toBeInTheDocument();
    expect(screen.getByText('Switch Workspace')).toBeInTheDocument();
    expect(mockRegisterWorkspace).not.toHaveBeenCalled();
  });

  it('registers the workspace when none is bound', async () => {
    mockUseChatroomWorkspaces.mockReturnValue({ workspaces: [], isLoading: false });

    renderModal();
    expect(screen.getByTestId('setup-workspace-step')).toBeInTheDocument();

    const onConfirm = mockSetupWorkspaceStep.mock.calls.at(-1)?.[0].onConfirm as (
      machineId: string,
      workingDir: string
    ) => Promise<void>;
    await onConfirm('m1', '/code');

    expect(mockRegisterWorkspace).toHaveBeenCalledTimes(1);
  });

  it('keeps the switch flow when a finished switch changes the workspace list', () => {
    const firstWorkspace = {
      id: 'm1::/code',
      machineId: 'm1',
      workingDir: '/code',
      hostname: 'dev',
      agentRoles: [],
      registeredAt: 100,
    };
    mockUseChatroomWorkspaces.mockReturnValue({ workspaces: [firstWorkspace], isLoading: false });
    mockUseChatroomWorkspace.mockReturnValue({
      activeWorkspace: {
        ...firstWorkspace,
        machineAlias: undefined,
        fileTreeSyncEnabled: true,
        _registryId: 'ws_1',
      },
      chatroomId: CHATROOM_ID,
      isLoading: false,
      workspaces: [firstWorkspace],
      switchWorkspace: vi.fn(),
    });
    const { rerender } = renderModal();
    expect(screen.getByTestId('setup-agent-team-step')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'back' }));
    expect(screen.getByTestId('switch-workspace-flow')).toBeInTheDocument();

    // The switch finishes and the registry now lists the new workspace.
    mockUseSwitchWorkspaceFlow.mockReturnValue({
      stage: 'done',
      busy: false,
      error: null,
      result: { outcome: 'switched' },
      stale: false,
      reset: vi.fn(),
    });
    mockUseChatroomWorkspaces.mockReturnValue({
      workspaces: [
        {
          ...firstWorkspace,
          id: 'm2::/srv',
          machineId: 'm2',
          workingDir: '/srv',
          registeredAt: 300,
        },
      ],
      isLoading: false,
    });
    rerender(modalElement());

    expect(screen.getByTestId('switch-workspace-flow')).toBeInTheDocument();
    expect(screen.queryByTestId('setup-agent-team-step')).not.toBeInTheDocument();
  });

  it('stays on the switch flow when the list updates with the same primary workspace', () => {
    const workspace = {
      id: 'm1::/code',
      machineId: 'm1',
      workingDir: '/code',
      hostname: 'dev',
      agentRoles: [],
      registeredAt: 100,
    };
    mockUseChatroomWorkspaces.mockReturnValue({ workspaces: [workspace], isLoading: false });
    mockUseChatroomWorkspace.mockReturnValue({
      activeWorkspace: {
        ...workspace,
        machineAlias: undefined,
        fileTreeSyncEnabled: true,
        _registryId: 'ws_1',
      },
      chatroomId: CHATROOM_ID,
      isLoading: false,
      workspaces: [workspace],
      switchWorkspace: vi.fn(),
    });

    const { rerender } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'back' }));
    expect(screen.getByTestId('switch-workspace-flow')).toBeInTheDocument();

    mockUseChatroomWorkspaces.mockReturnValue({
      workspaces: [{ ...workspace }],
      isLoading: false,
    });
    rerender(modalElement());

    expect(screen.getByTestId('switch-workspace-flow')).toBeInTheDocument();
    expect(screen.queryByTestId('setup-agent-team-step')).not.toBeInTheDocument();
  });
});
