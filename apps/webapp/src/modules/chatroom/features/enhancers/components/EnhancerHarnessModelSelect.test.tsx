import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EnhancerHarnessModelSelect } from './EnhancerHarnessModelSelect';

const mockUseDaemonConnected = vi.fn();
const mockUseChatroomWorkspaces = vi.fn();
const mockUseMachineModels = vi.fn();
const mockUseSessionQuery = vi.fn();
const mockRequestRefresh = vi.fn();

vi.mock('@/hooks/useDaemonConnected', () => ({
  useDaemonConnected: (...args: unknown[]) => mockUseDaemonConnected(...args),
}));

vi.mock('../../../workspace/hooks/useChatroomWorkspaces', () => ({
  useChatroomWorkspaces: (...args: unknown[]) => mockUseChatroomWorkspaces(...args),
}));

vi.mock('@/hooks/useMachineModels', () => ({
  useMachineModels: (...args: unknown[]) => mockUseMachineModels(...args),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (...args: unknown[]) => mockUseSessionQuery(...args),
  useSessionMutation: () => mockRequestRefresh,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    machines: {
      listMachines: 'machines:listMachines',
      getCapabilitiesRefreshBatch: 'machines:getCapabilitiesRefreshBatch',
      requestCapabilitiesRefresh: 'machines:requestCapabilitiesRefresh',
    },
    workspaces: {
      listWorkspacesForChatroom: 'workspaces:listWorkspacesForChatroom',
    },
  },
}));

vi.mock('@/modules/chatroom/components/model-selection', () => ({
  ModelPickerField: ({
    value,
    onValueChange,
    disabled,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    disabled?: boolean;
  }) => (
    <input
      data-testid="model-picker"
      value={value}
      disabled={disabled}
      onChange={(e) => onValueChange(e.target.value)}
    />
  ),
}));

vi.mock(
  '@/modules/chatroom/direct-harness/components/harness-selectors/HarnessHarnessSelect',
  () => ({
    HarnessHarnessSelect: ({
      value,
      onValueChange,
      disabled,
    }: {
      value: string;
      onValueChange: (v: string) => void;
      disabled?: boolean;
    }) => (
      <button
        type="button"
        data-testid="harness-select"
        data-value={value}
        disabled={disabled}
        onClick={() => onValueChange('cursor')}
      >
        {value || 'Harness...'}
      </button>
    ),
  })
);

const MACHINE = {
  machineId: 'machine-1',
  hostname: 'host-1',
  availableHarnesses: ['opencode', 'cursor'],
  harnessVersions: {},
};

function setupMocks(options?: {
  daemonConnected?: boolean;
  workspaces?: { machineId: string }[];
  batchSnapshot?: unknown;
}) {
  mockUseMachineModels.mockReturnValue({
    availableModels: { opencode: ['anthropic/claude-opus-4'], cursor: ['openai/gpt-4o'] },
    isLoading: false,
  });
  mockUseDaemonConnected.mockReturnValue({
    isConnected: options?.daemonConnected ?? false,
    isLoading: false,
  });
  mockUseChatroomWorkspaces.mockReturnValue({
    workspaces: options?.workspaces ?? [],
    isLoading: false,
    removeWorkspace: vi.fn(),
  });
  mockUseSessionQuery.mockImplementation((query: unknown, args: unknown) => {
    if (query === 'machines:listMachines') {
      return { machines: [MACHINE] };
    }
    if (query === 'machines:getCapabilitiesRefreshBatch') {
      if (args === 'skip') return undefined;
      return options?.batchSnapshot;
    }
    return undefined;
  });
}

describe('EnhancerHarnessModelSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestRefresh.mockResolvedValue({ applied: true, batchId: 'batch-1' });
  });

  it('renders the shared refresh button when a machine is selected', () => {
    setupMocks({ daemonConnected: false, workspaces: [] });
    render(
      <EnhancerHarnessModelSelect
        chatroomId="room-1"
        machineId="machine-1"
        agentHarness="opencode"
        model="anthropic/claude-opus-4"
        onHarnessChange={vi.fn()}
        onModelChange={vi.fn()}
      />
    );

    expect(screen.getByTestId('machine-capabilities-refresh-button')).toBeInTheDocument();
  });

  it('disables the refresh button with an explanatory title when offline and unlinked', () => {
    setupMocks({ daemonConnected: false, workspaces: [] });
    render(
      <EnhancerHarnessModelSelect
        chatroomId="room-1"
        machineId="machine-1"
        agentHarness="opencode"
        model=""
        onHarnessChange={vi.fn()}
        onModelChange={vi.fn()}
      />
    );

    const button = screen.getByTestId('machine-capabilities-refresh-button');
    expect(button.hasAttribute('disabled')).toBe(true);
    // Unlinked takes precedence in the shared button's title contract.
    expect(button.getAttribute('title')).toBe('This machine has no workspace in this chatroom.');
    expect(mockUseDaemonConnected).toHaveBeenCalledWith('machine-1');
    expect(mockUseChatroomWorkspaces).toHaveBeenCalledWith('room-1');
  });

  it('invokes the existing capabilities refresh mutation when linked and connected', async () => {
    setupMocks({
      daemonConnected: true,
      workspaces: [{ machineId: 'machine-1' }],
      batchSnapshot: undefined,
    });
    render(
      <EnhancerHarnessModelSelect
        chatroomId="room-1"
        machineId="machine-1"
        agentHarness="opencode"
        model=""
        onHarnessChange={vi.fn()}
        onModelChange={vi.fn()}
      />
    );

    const button = screen.getByTestId('machine-capabilities-refresh-button');
    expect(button.hasAttribute('disabled')).toBe(false);

    fireEvent.click(button);

    await waitFor(() => {
      expect(mockRequestRefresh).toHaveBeenCalledWith({
        chatroomId: 'room-1',
        machineId: 'machine-1',
      });
    });
  });

  it('keeps harness and model selectors wired to value changes', () => {
    setupMocks({ daemonConnected: true, workspaces: [{ machineId: 'machine-1' }] });
    const onHarnessChange = vi.fn();
    const onModelChange = vi.fn();
    render(
      <EnhancerHarnessModelSelect
        chatroomId="room-1"
        machineId="machine-1"
        agentHarness="opencode"
        model="anthropic/claude-opus-4"
        onHarnessChange={onHarnessChange}
        onModelChange={onModelChange}
      />
    );

    fireEvent.click(screen.getByTestId('harness-select'));
    expect(onHarnessChange).toHaveBeenCalledWith('cursor');
    // Harness change clears the model via the existing handler.
    expect(onModelChange).toHaveBeenCalledWith('');

    fireEvent.change(screen.getByTestId('model-picker'), {
      target: { value: 'openai/gpt-4o' },
    });
    expect(onModelChange).toHaveBeenCalledWith('openai/gpt-4o');
  });

  it('shows the empty-machine helper and no refresh control without a machine', () => {
    setupMocks({ daemonConnected: false, workspaces: [] });
    render(
      <EnhancerHarnessModelSelect
        chatroomId="room-1"
        machineId={null}
        agentHarness={null}
        model=""
        onHarnessChange={vi.fn()}
        onModelChange={vi.fn()}
      />
    );

    expect(
      screen.getByText('Select a workspace with a connected machine to choose a model.')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('machine-capabilities-refresh-button')).toBeNull();
  });
});
