import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SwitchWorkspaceDialog } from './SwitchWorkspaceDialog';
import { resetOverlayDismissStackForTests } from '../../components/shared/overlayDismissStack';

import type { RemoteFolderBrowserState } from '@/hooks/useRemoteFolderBrowser';

const CONSEQUENCES = [
  "Running agents are stopped. Work in progress may be interrupted. The stop request is queued for the machine's daemon.",
  'The current workspace is removed from this chatroom (soft-deleted; switching back adds it again). Cached file-tree data for it is cleared.',
  'Agent configurations are carried over where possible: same role, and the harness must be available on the new machine.',
  'Agents do not start on the new workspace. Start them from the agent panel afterwards.',
  'No files are changed on either machine.',
];

const mockUseConnectedMachines = vi.fn();
const mockUseMachineCapabilities = vi.fn();
const mockUseAgentConfigs = vi.fn();
const mockUseChatroomWorkspace = vi.fn();
const mockSwitch = vi.fn();

vi.mock('@/hooks/useConnectedMachines', () => ({
  useConnectedMachines: () => mockUseConnectedMachines(),
}));

vi.mock('@/hooks/useMachineCapabilities', () => ({
  useMachineCapabilities: () => mockUseMachineCapabilities(),
}));

// A stateful stand-in for the remote browser hook: open shows a ready listing, and the browser
// stays mounted until select, cancel or close, so the panel's Escape and machine-change paths can run.
const mockBrowserClose = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useRemoteFolderBrowser', async () => {
  const ReactModule = await import('react');
  return {
    useRemoteFolderBrowser: ({ onSelected }: { onSelected: (path: string) => void }) => {
      const [browser, setBrowser] = ReactModule.useState<RemoteFolderBrowserState | null>(null);
      const close = () => {
        mockBrowserClose();
        setBrowser(null);
      };
      const open = async () => {
        setBrowser({
          phase: 'ready',
          machineDisplayName: 'laptop',
          listing: {
            path: '/srv',
            parentPath: '/',
            requestedPath: '/srv',
            entries: [{ name: 'alpha' }],
            dirCount: 1,
            fileCount: 0,
            hiddenCount: 0,
            truncated: false,
            complete: true,
            selectable: true,
            fellBack: false,
          },
          isNavigating: false,
          showHidden: false,
          filter: '',
          error: null,
          navigate: vi.fn(),
          goUp: vi.fn(),
          goHome: vi.fn(),
          setShowHidden: vi.fn(),
          setFilter: vi.fn(),
          retry: vi.fn(),
          select: () => {
            onSelected('/srv');
            setBrowser(null);
          },
          cancel: close,
        });
      };
      return { browser, open, close };
    },
  };
});

vi.mock('@/modules/chatroom/hooks/useAgentConfigs', () => ({
  useAgentConfigs: () => mockUseAgentConfigs(),
}));

vi.mock('@/modules/chatroom/context/ChatroomWorkspaceContext', () => ({
  useChatroomWorkspace: () => mockUseChatroomWorkspace(),
}));

const CHATROOM_ID = 'jd7testchatroom0000000000000001';

const CURRENT = {
  id: 'm1::/code/app',
  machineId: 'm1',
  hostname: 'laptop',
  machineAlias: undefined,
  workingDir: '/code/app',
  agentRoles: [],
  fileTreeSyncEnabled: true,
  _registryId: 'ws_1',
};

const MACHINES = [
  { machineId: 'm1', hostname: 'laptop', os: 'darwin', registeredAt: 1 },
  { machineId: 'm2', hostname: 'desktop', os: 'darwin', registeredAt: 2 },
];

const SWITCHED = {
  outcome: 'switched',
  workspaceId: 'ws_2',
  machineId: 'm2',
  workingDir: '/srv/app',
  previousWorkspaceIds: ['ws_1'],
  agentsStopRequested: false,
  configsMigrated: [],
  configsSkipped: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function setActiveWorkspace(workspace: typeof CURRENT) {
  mockUseChatroomWorkspace.mockReturnValue({
    chatroomId: CHATROOM_ID,
    activeWorkspace: workspace,
    switchWorkspace: mockSwitch,
    isLoading: false,
    workspaces: [workspace],
    setPrimaryWorkspace: vi.fn(),
    removeWorkspace: vi.fn(),
  });
}

/** Choose → type a path → Review. Returns the path input. */
async function goToReview(user: ReturnType<typeof userEvent.setup>, path = '/srv/app') {
  const input = screen.getByLabelText('Workspace Folder');
  await user.type(input, path);
  await user.click(screen.getByRole('button', { name: 'Review switch' }));
  return input;
}

describe('SwitchWorkspaceDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    resetOverlayDismissStackForTests();
    setActiveWorkspace(CURRENT);
    mockUseConnectedMachines.mockReturnValue({
      machines: MACHINES,
      connectedMachineIds: new Set(['m1']),
      isLoading: false,
    });
    mockUseMachineCapabilities.mockReturnValue({
      availableHarnesses: ['cursor-sdk'],
      isLoading: false,
    });
    mockUseAgentConfigs.mockReturnValue({ configs: [], isLoading: false });
    mockSwitch.mockResolvedValue(SWITCHED);
  });

  it('preselects the current machine and shows the current workspace', () => {
    render(<SwitchWorkspaceDialog onClose={vi.fn()} />);

    const summary = screen.getByTestId('switch-current-summary');
    expect(summary).toHaveTextContent('app');
    expect(summary).toHaveTextContent('/code/app');
    expect(screen.getByRole('button', { name: /laptop/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Review switch' })).toBeDisabled();
  });

  it('offers an offline machine with a label and keeps it selectable', async () => {
    const user = userEvent.setup();
    render(<SwitchWorkspaceDialog onClose={vi.fn()} />);

    const offlineRow = screen.getByRole('button', { name: /desktop/i });
    expect(offlineRow).toHaveTextContent('Offline');
    expect(offlineRow).toBeEnabled();

    await user.click(offlineRow);

    expect(screen.getByTestId('switch-offline-warning')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /browse/i })).toBeDisabled();
  });

  it('enables Review switch only for a different, non-empty target', async () => {
    const user = userEvent.setup();
    render(<SwitchWorkspaceDialog onClose={vi.fn()} />);

    const input = screen.getByLabelText('Workspace Folder');
    const review = screen.getByRole('button', { name: 'Review switch' });
    expect(review).toBeDisabled();

    await user.type(input, '/code/app');
    expect(screen.getByText('This is already the current workspace.')).toBeInTheDocument();
    expect(review).toBeDisabled();

    await user.clear(input);
    await user.type(input, '/code/app2');
    await waitFor(() => expect(review).toBeEnabled());
  });

  it('shows the five consequences and gates the confirm on the checkbox', async () => {
    const user = userEvent.setup();
    render(<SwitchWorkspaceDialog onClose={vi.fn()} />);

    await goToReview(user);

    const review = within(screen.getByTestId('switch-review'));
    expect(review.getByText('From')).toBeInTheDocument();
    expect(review.getByText('/code/app')).toBeInTheDocument();
    expect(review.getByText('To')).toBeInTheDocument();
    expect(review.getByText('/srv/app')).toBeInTheDocument();
    for (const line of CONSEQUENCES) {
      expect(screen.getByText(line)).toBeInTheDocument();
    }

    const confirm = screen.getByTestId('switch-confirm');
    expect(confirm).toBeDisabled();

    await user.click(screen.getByTestId('switch-ack'));
    expect(confirm).toBeEnabled();
  });

  it('keeps the typed path when Back returns to Choose', async () => {
    const user = userEvent.setup();
    render(<SwitchWorkspaceDialog onClose={vi.fn()} />);

    await goToReview(user, '/srv/typed');
    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByLabelText('Workspace Folder')).toHaveValue('/srv/typed');
  });

  it('submits once and locks the dialog while the switch is pending', async () => {
    const user = userEvent.setup();
    const pending = deferred<typeof SWITCHED>();
    mockSwitch.mockReturnValue(pending.promise);
    render(<SwitchWorkspaceDialog onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /desktop/i }));
    await goToReview(user, '/srv/app');
    await user.click(screen.getByTestId('switch-ack'));

    act(() => {
      fireEvent.click(screen.getByTestId('switch-confirm'));
    });

    expect(mockSwitch).toHaveBeenCalledTimes(1);
    expect(mockSwitch).toHaveBeenCalledWith('m2', '/srv/app');
    expect(screen.getByTestId('switch-confirm')).toHaveTextContent('Switching…');
    expect(screen.getByTestId('switch-ack')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByTestId('switch-workspace-dialog'), { key: 'Escape' });
    expect(screen.getByTestId('switch-workspace-dialog')).toBeInTheDocument();

    await act(async () => {
      pending.resolve(SWITCHED);
    });
  });

  it('reports the switched result honestly', async () => {
    const user = userEvent.setup();
    mockSwitch.mockResolvedValue({
      ...SWITCHED,
      agentsStopRequested: false,
      configsMigrated: ['planner', 'builder'],
      configsSkipped: [{ role: 'reviewer', reason: 'harness_unavailable' }],
    });
    render(<SwitchWorkspaceDialog onClose={vi.fn()} />);

    await goToReview(user);
    await user.click(screen.getByTestId('switch-ack'));
    await user.click(screen.getByTestId('switch-confirm'));

    expect(screen.getByTestId('switch-result')).toBeInTheDocument();
    expect(
      screen.getByText('No agents were running on the previous workspace.')
    ).toBeInTheDocument();
    expect(screen.getByText('Agents were not started on the new workspace.')).toBeInTheDocument();
    expect(screen.getByText('planner · builder')).toBeInTheDocument();
    expect(screen.getByText('Harness not available on the new machine')).toBeInTheDocument();
  });

  it('reports a queued agent stop when one was requested', async () => {
    const user = userEvent.setup();
    mockSwitch.mockResolvedValue({ ...SWITCHED, agentsStopRequested: true });
    render(<SwitchWorkspaceDialog onClose={vi.fn()} />);

    await goToReview(user);
    await user.click(screen.getByTestId('switch-ack'));
    await user.click(screen.getByTestId('switch-confirm'));

    expect(
      screen.getByText('Stop requested for agents on the previous workspace.')
    ).toBeInTheDocument();
  });

  it('reports an unchanged result', async () => {
    const user = userEvent.setup();
    mockSwitch.mockResolvedValue({ ...SWITCHED, outcome: 'unchanged' });
    render(<SwitchWorkspaceDialog onClose={vi.fn()} />);

    await goToReview(user);
    await user.click(screen.getByTestId('switch-ack'));
    await user.click(screen.getByTestId('switch-confirm'));

    expect(screen.getByText('Nothing changed')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Already the current workspace. Nothing was changed and no agents were stopped.'
      )
    ).toBeInTheDocument();
  });

  it('returns to Choose with an invalid path error', async () => {
    const user = userEvent.setup();
    mockSwitch.mockRejectedValue({ data: { code: 'INVALID_WORKING_DIR' } });
    render(<SwitchWorkspaceDialog onClose={vi.fn()} />);

    await goToReview(user);
    await user.click(screen.getByTestId('switch-ack'));
    await user.click(screen.getByTestId('switch-confirm'));

    expect(screen.queryByTestId('switch-review')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Workspace Folder')).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByText(
        "That path isn't valid. Use an absolute folder path such as /Users/you/projects."
      )
    ).toBeInTheDocument();
  });

  it('shows the conflict panel and never submits twice', async () => {
    const user = userEvent.setup();
    mockSwitch.mockRejectedValue({ data: { code: 'WORKSPACE_SWITCH_CONFLICT' } });
    render(<SwitchWorkspaceDialog onClose={vi.fn()} />);

    await goToReview(user);
    await user.click(screen.getByTestId('switch-ack'));
    await user.click(screen.getByTestId('switch-confirm'));

    expect(mockSwitch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('switch-conflict')).toBeInTheDocument();
    expect(screen.queryByTestId('switch-confirm')).not.toBeInTheDocument();
  });

  it('shows a machine error inline on Review', async () => {
    const user = userEvent.setup();
    mockSwitch.mockRejectedValue({ data: { code: 'NOT_AUTHORIZED_MACHINE' } });
    render(<SwitchWorkspaceDialog onClose={vi.fn()} />);

    await goToReview(user);
    await user.click(screen.getByTestId('switch-ack'));
    await user.click(screen.getByTestId('switch-confirm'));

    expect(screen.getByTestId('switch-error')).toBeInTheDocument();
    expect(screen.getByTestId('switch-confirm')).toBeEnabled();
  });

  it('shows the generic error inline and keeps confirm enabled for retry', async () => {
    const user = userEvent.setup();
    mockSwitch.mockRejectedValue(new Error('boom'));
    render(<SwitchWorkspaceDialog onClose={vi.fn()} />);

    await goToReview(user);
    await user.click(screen.getByTestId('switch-ack'));
    await user.click(screen.getByTestId('switch-confirm'));

    expect(screen.getByText('Could not switch the workspace. Try again.')).toBeInTheDocument();
    expect(screen.getByTestId('switch-confirm')).toBeEnabled();
  });

  it('shows the conflict panel when the live workspace changes during Review', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SwitchWorkspaceDialog onClose={vi.fn()} />);

    await goToReview(user);

    setActiveWorkspace({ ...CURRENT, _registryId: 'ws_2', id: 'm2::/srv/app', machineId: 'm2' });
    rerender(<SwitchWorkspaceDialog onClose={vi.fn()} />);

    expect(screen.getByTestId('switch-conflict')).toBeInTheDocument();
    expect(mockSwitch).not.toHaveBeenCalled();
  });
  it('Escape closes only the browser, and the dialog stays open', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SwitchWorkspaceDialog onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Browse' }));
    expect(await screen.findByRole('region')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.getByTestId('switch-workspace-dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('choosing another machine closes the open browser and its session', async () => {
    const user = userEvent.setup();
    render(<SwitchWorkspaceDialog onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Browse' }));
    expect(await screen.findByRole('region')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /desktop/i }));

    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(mockBrowserClose).toHaveBeenCalled();
  });
});
