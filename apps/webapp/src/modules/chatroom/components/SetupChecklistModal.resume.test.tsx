import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SetupChecklistModal } from './SetupChecklistModal';

const mockUseChatroomWorkspaces = vi.fn();
const mockUseAgentPanelData = vi.fn();
const mockUseDaemonConnectivity = vi.fn();
const mockSetupWorkspaceStep = vi.fn();

vi.mock('../workspace/hooks/useChatroomWorkspaces', () => ({
  useChatroomWorkspaces: (...args: unknown[]) => mockUseChatroomWorkspaces(...args),
}));

vi.mock('../hooks/useAgentPanelData', () => ({
  useAgentPanelData: (...args: unknown[]) => mockUseAgentPanelData(...args),
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
  SetupAgentTeamStep: () => <div data-testid="setup-agent-team-step" />,
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => vi.fn().mockResolvedValue(undefined),
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

function renderModal(overrides?: Partial<React.ComponentProps<typeof SetupChecklistModal>>) {
  return render(
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

describe('SetupChecklistModal resume', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDaemonConnectivity.mockReturnValue(new Map());
    mockUseAgentPanelData.mockReturnValue({
      machines: [],
      machineConfigs: [],
      isLoading: false,
      sendCommand: vi.fn(),
      agents: [],
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
      availableHarnesses: ['opencode-sdk'],
      harnessVersions: {},
    };
    const offlineMachine = {
      machineId: 'm2',
      hostname: 'offline-host',
      os: 'darwin',
      availableHarnesses: ['opencode-sdk'],
      harnessVersions: {},
    };
    mockUseAgentPanelData.mockReturnValue({
      machines: [connectedMachine, offlineMachine],
      machineConfigs: [],
      isLoading: false,
      sendCommand: vi.fn(),
      agents: [],
    });
    mockUseDaemonConnectivity.mockReturnValue(
      new Map([
        ['m1', { connected: true, lastSeenAt: 1 }],
        ['m2', { connected: false, lastSeenAt: 1 }],
      ])
    );
    mockUseChatroomWorkspaces.mockReturnValue({ workspaces: [], isLoading: false });

    renderModal();

    expect(mockUseDaemonConnectivity).toHaveBeenCalledWith(['m1', 'm2']);
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
});
