import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConvexError } from 'convex/values';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GitCloneViewState } from './lib/deriveGitCloneViewState';
import { NewChatroomWizard } from './NewChatroomWizard';

const mocks = vi.hoisted(() => ({
  createWithWorkspace: vi.fn(),
  machines: [] as { machineId: string; hostname: string; os: string; registeredAt: number }[],
  machinesLoading: false,
  connectivity: new Map<string, { connected: boolean }>(),
  // The clone hook is controlled per test, so the wizard can be driven into each clone state.
  clone: {
    viewState: { kind: 'idle' } as GitCloneViewState,
    requestId: null as string | null,
    start: vi.fn(),
    reset: vi.fn(),
  },
}));

vi.mock('./hooks/useGitCloneRequest', () => ({
  useGitCloneRequest: () => mocks.clone,
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: (name: unknown) =>
    name === 'chatrooms:createWithWorkspace'
      ? mocks.createWithWorkspace
      : vi.fn().mockResolvedValue(undefined),
  useSessionQuery: (name: unknown, args: unknown) => {
    if (args === 'skip') return undefined;
    if (name === 'chatrooms:getTeamStructureForChatroom') {
      return {
        teamId: 'duo',
        teamName: 'Duo',
        roles: [{ role: 'planner' }, { role: 'builder' }],
        entryPoint: 'planner',
      };
    }
    if (name === 'agents:listLastSentLaunchRequests') return [];
    return undefined;
  },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    chatrooms: {
      createWithWorkspace: 'chatrooms:createWithWorkspace',
      updateTeam: 'chatrooms:updateTeam',
      getTeamStructureForChatroom: 'chatrooms:getTeamStructureForChatroom',
    },
    agents: {
      listLastSentLaunchRequests: 'agents:listLastSentLaunchRequests',
    },
    machines: {
      getUserMachines: 'machines:getUserMachines',
    },
    gitCloneRequests: {
      request: 'gitCloneRequests:request',
      get: 'gitCloneRequests:get',
    },
  },
}));

vi.mock('@/hooks/useUserMachines', () => ({
  useUserMachines: () => ({ machines: mocks.machines, isLoading: mocks.machinesLoading }),
}));

vi.mock('@/hooks/useDaemonConnectivity', () => ({
  useDaemonConnectivity: () => mocks.connectivity,
}));

vi.mock('@/hooks/useFolderPicker', () => ({
  useFolderPicker: () => ({
    pickFolder: vi.fn(),
    request: undefined,
    requestId: null,
    reset: vi.fn(),
    isPending: false,
    isTimedOut: false,
  }),
}));

vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));

// The agent cards are covered by their own suites. This stub reports the props the wizard passes.
vi.mock('../../components/setup/SetupAgentTeamStep', async () => {
  const ReactModule = await import('react');
  return {
    SetupAgentTeamStep: (props: {
      machineId: string;
      workingDir: string;
      onBack?: unknown;
      footerSecondary?: unknown;
    }) =>
      ReactModule.createElement(
        ReactModule.Fragment,
        null,
        ReactModule.createElement(
          'div',
          { 'data-testid': 'agents-step' },
          `${props.machineId} ${props.workingDir} ${props.onBack ? 'back' : 'no-back'}`
        ),
        ReactModule.createElement(
          'div',
          { 'data-slot': 'setup-step-footer' },
          props.footerSecondary as React.ReactNode
        )
      ),
  };
});

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const CHATROOM_ID = 'jd7testchatroom0000000000000001';
const MACHINE_A = { machineId: 'machine-a', hostname: 'laptop', os: 'darwin', registeredAt: 1 };
const MACHINE_B = { machineId: 'machine-b', hostname: 'desk', os: 'linux', registeredAt: 2 };
const FOLDER = '/Users/me/src/app';

function renderWizard(overrides: { onCreated?: () => void; onCancel?: () => void } = {}) {
  const onCreated = overrides.onCreated ?? vi.fn();
  const onCancel = overrides.onCancel ?? vi.fn();
  render(<NewChatroomWizard onCreated={onCreated} onCancel={onCancel} />);
  return { onCreated, onCancel };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.machines = [MACHINE_A];
  mocks.machinesLoading = false;
  mocks.connectivity = new Map([['machine-a', { connected: true }]]);
  mocks.createWithWorkspace.mockReset();
  mocks.createWithWorkspace.mockResolvedValue({ chatroomId: CHATROOM_ID, workspaceId: 'ws-1' });
  mocks.clone.viewState = { kind: 'idle' };
  mocks.clone.requestId = null;
});

const COMPLETED_CLONE: GitCloneViewState = { kind: 'completed', clonedPath: '/tmp/x/repo' };

/** Opens the wizard on the workspace step, where the clone tab is shown by default. */
async function openWorkspaceStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('NewChatroomWizard machine step', () => {
  it('shows the prerequisites panel and no Continue when no machine is connected', () => {
    mocks.connectivity = new Map();
    renderWizard();

    expect(screen.getByText('Prerequisites')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  it('auto-selects the only connected machine', () => {
    renderWizard();

    expect(screen.getByRole('button', { name: 'Continue' })).not.toHaveProperty('disabled', true);
  });

  it('renders an offline machine as a disabled row labelled Offline', () => {
    mocks.machines = [MACHINE_A, MACHINE_B];
    renderWizard();

    const offline = screen.getByRole('button', { name: /desk/ });
    expect(offline).toHaveProperty('disabled', true);
    expect(offline.textContent).toContain('Offline');
  });

  it('cancels on Escape from the machine step', () => {
    const { onCancel } = renderWizard();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('NewChatroomWizard existing-folder path', () => {
  it('creates the chatroom once with the chosen folder and moves to the agents step', async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('tab', { name: 'Existing folder' }));
    await user.type(screen.getByLabelText('Folder path'), FOLDER);
    await user.click(screen.getByRole('button', { name: 'Create chatroom' }));

    await waitFor(() => expect(screen.getByTestId('agents-step')).toBeTruthy());
    expect(mocks.createWithWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.createWithWorkspace).toHaveBeenCalledWith({
      teamStructureId: 'duo',
      machineId: 'machine-a',
      workingDir: FOLDER,
    });
    expect(screen.getByTestId('agents-step').textContent).toBe(`machine-a ${FOLDER} no-back`);
  });

  it('shows the path field only, with no folder list or search', async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('tab', { name: 'Existing folder' }));

    expect(screen.getByLabelText('Folder path')).toBeTruthy();
    expect(screen.queryByText('Folders on this machine')).toBeNull();
    expect(screen.queryByPlaceholderText('Search folders…')).toBeNull();
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('keeps Create disabled for a path that is not absolute', async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('tab', { name: 'Existing folder' }));
    await user.type(screen.getByLabelText('Folder path'), 'relative/path');

    expect(screen.getByRole('button', { name: 'Create chatroom' })).toHaveProperty(
      'disabled',
      true
    );
    expect(mocks.createWithWorkspace).not.toHaveBeenCalled();
  });

  it('does not create a second chatroom on repeated clicks', async () => {
    const user = userEvent.setup();
    let resolveCreate: (value: { chatroomId: string }) => void = () => {};
    mocks.createWithWorkspace.mockImplementation(
      () => new Promise((resolve) => (resolveCreate = resolve))
    );
    renderWizard();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('tab', { name: 'Existing folder' }));
    await user.type(screen.getByLabelText('Folder path'), FOLDER);
    const create = screen.getByRole('button', { name: 'Create chatroom' });
    fireEvent.click(create);
    fireEvent.click(create);

    expect(mocks.createWithWorkspace).toHaveBeenCalledTimes(1);
    resolveCreate({ chatroomId: CHATROOM_ID });
    await waitFor(() => expect(screen.getByTestId('agents-step')).toBeTruthy());
  });

  it('stays on the folder step and shows the error when creation fails', async () => {
    const user = userEvent.setup();
    mocks.createWithWorkspace.mockRejectedValue(new Error('Working directory must be absolute'));
    renderWizard();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('tab', { name: 'Existing folder' }));
    await user.type(screen.getByLabelText('Folder path'), FOLDER);
    await user.click(screen.getByRole('button', { name: 'Create chatroom' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Working directory must be absolute');
    expect(screen.getByRole('button', { name: 'Create chatroom' })).toBeTruthy();
    expect(screen.queryByTestId('agents-step')).toBeNull();
  });
});

describe('NewChatroomWizard clone recovery', () => {
  it('keeps the clone when the chatroom cannot be created, and retries from Create chatroom', async () => {
    const user = userEvent.setup();
    mocks.clone.viewState = COMPLETED_CLONE;
    mocks.clone.requestId = 'req-1';
    mocks.createWithWorkspace
      .mockRejectedValueOnce(new ConvexError({ message: 'boom' }))
      .mockResolvedValueOnce({ chatroomId: CHATROOM_ID, workspaceId: 'ws-1' });
    renderWizard();

    await openWorkspaceStep(user);

    // The completed clone hands its path over on its own. The failure shows once, next to the retry.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'Cloned to /tmp/x/repo, but the chatroom could not be created: boom. The clone is kept — select Create chatroom to try again.'
    );
    expect(screen.getAllByRole('alert')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Create chatroom' }));

    await waitFor(() => expect(screen.getByTestId('agents-step')).toBeTruthy());
    expect(mocks.createWithWorkspace).toHaveBeenCalledTimes(2);
    expect(mocks.createWithWorkspace).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ workingDir: '/tmp/x/repo' })
    );
    expect(mocks.createWithWorkspace).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ workingDir: '/tmp/x/repo' })
    );
  });

  it('a double click on the retry makes exactly one extra call', async () => {
    const user = userEvent.setup();
    mocks.clone.viewState = COMPLETED_CLONE;
    mocks.clone.requestId = 'req-1';
    let resolveRetry: (value: { chatroomId: string; workspaceId: string }) => void = () => {};
    mocks.createWithWorkspace
      .mockRejectedValueOnce(new ConvexError({ message: 'boom' }))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveRetry = resolve)));
    renderWizard();

    await openWorkspaceStep(user);
    await screen.findByRole('alert');
    const retry = screen.getByRole('button', { name: 'Create chatroom' });
    fireEvent.click(retry);
    fireEvent.click(retry);

    expect(mocks.createWithWorkspace).toHaveBeenCalledTimes(2);
    resolveRetry({ chatroomId: CHATROOM_ID, workspaceId: 'ws-1' });
    await waitFor(() => expect(screen.getByTestId('agents-step')).toBeTruthy());
  });
});

describe('NewChatroomWizard leaving during a clone', () => {
  it.each<[string, GitCloneViewState]>([
    ['cloning', { kind: 'cloning', phase: 'Receiving objects', percent: 10 }],
    ['waiting', { kind: 'waiting', offline: false }],
    ['stalled', { kind: 'stalled' }],
  ])(
    'Escape while %s asks before leaving, and Keep waiting keeps the wizard open',
    async (_label, viewState) => {
      const user = userEvent.setup();
      mocks.clone.viewState = viewState;
      mocks.clone.requestId = 'req-1';
      const { onCancel } = renderWizard();
      await openWorkspaceStep(user);

      await user.keyboard('{Escape}');

      const dialog = await screen.findByRole('alertdialog');
      expect(within(dialog).getByText('Stop waiting for this clone?')).toBeTruthy();
      // Focus moves into the dialog after it mounts, so wait for it rather than checking once.
      await waitFor(() =>
        expect(document.activeElement).toBe(
          within(dialog).getByRole('button', { name: 'Keep waiting' })
        )
      );
      expect(onCancel).not.toHaveBeenCalled();

      await user.click(within(dialog).getByRole('button', { name: 'Keep waiting' }));

      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      expect(onCancel).not.toHaveBeenCalled();
      expect(screen.getByRole('tab', { name: 'Git repository' })).toBeTruthy();
    }
  );

  it('Leave cancels the wizard', async () => {
    const user = userEvent.setup();
    mocks.clone.viewState = { kind: 'stalled' };
    mocks.clone.requestId = 'req-1';
    const { onCancel } = renderWizard();
    await openWorkspaceStep(user);

    await user.keyboard('{Escape}');
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave' })
    );

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('a second Escape closes the confirm and keeps the wizard open', async () => {
    const user = userEvent.setup();
    mocks.clone.viewState = { kind: 'stalled' };
    mocks.clone.requestId = 'req-1';
    const { onCancel } = renderWizard();
    await openWorkspaceStep(user);

    await user.keyboard('{Escape}');
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onCancel).not.toHaveBeenCalled();
  });

  it.each<[string, GitCloneViewState]>([
    ['idle', { kind: 'idle' }],
    ['failed', { kind: 'failed', errorCode: 'auth', message: 'Authentication failed.' }],
    ['timed out', { kind: 'timed_out' }],
  ])('Escape while %s cancels straight away, with no confirm', async (_label, viewState) => {
    const user = userEvent.setup();
    mocks.clone.viewState = viewState;
    const { onCancel } = renderWizard();
    await openWorkspaceStep(user);

    await user.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('Escape after a completed clone asks with the completed wording', async () => {
    const user = userEvent.setup();
    mocks.clone.viewState = COMPLETED_CLONE;
    mocks.clone.requestId = 'req-1';
    mocks.createWithWorkspace.mockRejectedValueOnce(new Error('boom'));
    const { onCancel } = renderWizard();
    await openWorkspaceStep(user);
    await screen.findByRole('alert');

    await user.keyboard('{Escape}');

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Leave before creating the chatroom?')).toBeTruthy();
    expect(
      within(dialog).getByText(
        'The cloned folder stays on disk, but no chatroom will be created from it.'
      )
    ).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'Stay' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('Escape while the chatroom is being created does nothing', async () => {
    const user = userEvent.setup();
    mocks.clone.viewState = COMPLETED_CLONE;
    mocks.clone.requestId = 'req-1';
    mocks.createWithWorkspace.mockImplementationOnce(() => new Promise(() => {}));
    const { onCancel } = renderWizard();
    await openWorkspaceStep(user);
    await waitFor(() => expect(mocks.createWithWorkspace).toHaveBeenCalledTimes(1));

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
  });
});

/** The shared step footer that contains an action, or null when the action is outside a footer. */
function footerOf(element: HTMLElement): HTMLElement | null {
  return element.closest<HTMLElement>('[data-slot="setup-step-footer"]');
}

describe('NewChatroomWizard shared footer', () => {
  it('keeps Continue, Clone and Create chatroom in the step footer', async () => {
    const user = userEvent.setup();
    renderWizard();
    expect(footerOf(screen.getByRole('button', { name: 'Continue' }))).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(footerOf(screen.getByRole('button', { name: 'Clone' }))).not.toBeNull();

    await user.click(screen.getByRole('tab', { name: 'Existing folder' }));
    await user.type(screen.getByLabelText('Folder path'), FOLDER);
    expect(footerOf(screen.getByRole('button', { name: 'Create chatroom' }))).not.toBeNull();
  });

  it('keeps Open chatroom in the agents step footer', async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('tab', { name: 'Existing folder' }));
    await user.type(screen.getByLabelText('Folder path'), FOLDER);
    await user.click(screen.getByRole('button', { name: 'Create chatroom' }));

    await waitFor(() => expect(screen.getByTestId('agents-step')).toBeTruthy());
    expect(footerOf(screen.getByRole('button', { name: 'Open chatroom' }))).not.toBeNull();
  });

  it('Enter in the folder path field does not create a chatroom when the path is empty or relative', async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('tab', { name: 'Existing folder' }));
    const pathField = screen.getByLabelText('Folder path');
    await user.type(pathField, '{Enter}');
    await user.clear(pathField);
    await user.type(pathField, 'relative/path{Enter}');

    expect(mocks.createWithWorkspace).not.toHaveBeenCalled();
  });

  it('the footer Create chatroom submits the existing-folder form', async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('tab', { name: 'Existing folder' }));
    await user.type(screen.getByLabelText('Folder path'), FOLDER);
    await user.click(screen.getByRole('button', { name: 'Create chatroom' }));

    await waitFor(() => expect(mocks.createWithWorkspace).toHaveBeenCalledTimes(1));
    expect(mocks.createWithWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ workingDir: FOLDER })
    );
  });
});
