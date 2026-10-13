import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewChatroomWizard } from './NewChatroomWizard';

const mocks = vi.hoisted(() => ({
  createWithWorkspace: vi.fn(),
  machines: [] as { machineId: string; hostname: string; os: string; registeredAt: number }[],
  machinesLoading: false,
  connectivity: new Map<string, { connected: boolean }>(),
  folders: [] as string[],
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: (name: unknown) =>
    name === 'chatrooms:createWithWorkspace'
      ? mocks.createWithWorkspace
      : vi.fn().mockResolvedValue(undefined),
  useSessionQuery: (name: unknown, args: unknown) => {
    if (args === 'skip') return undefined;
    if (name === 'workspaces:listRegisteredWorkingDirsForMachine') return mocks.folders;
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
    workspaces: {
      listRegisteredWorkingDirsForMachine: 'workspaces:listRegisteredWorkingDirsForMachine',
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
    SetupAgentTeamStep: (props: { machineId: string; workingDir: string; onBack?: unknown }) =>
      ReactModule.createElement(
        'div',
        { 'data-testid': 'agents-step' },
        `${props.machineId} ${props.workingDir} ${props.onBack ? 'back' : 'no-back'}`
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
  mocks.folders = [FOLDER];
  mocks.createWithWorkspace.mockReset();
  mocks.createWithWorkspace.mockResolvedValue({ chatroomId: CHATROOM_ID, workspaceId: 'ws-1' });
});

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
    await user.click(screen.getByRole('option', { name: FOLDER }));
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
    await user.click(screen.getByRole('option', { name: FOLDER }));
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
    await user.click(screen.getByRole('option', { name: FOLDER }));
    await user.click(screen.getByRole('button', { name: 'Create chatroom' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Working directory must be absolute');
    expect(screen.getByRole('button', { name: 'Create chatroom' })).toBeTruthy();
    expect(screen.queryByTestId('agents-step')).toBeNull();
  });
});
