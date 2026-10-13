import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CloneRepoForm } from './CloneRepoForm';
import type { GitCloneViewState } from './lib/deriveGitCloneViewState';
import type { UseGitCloneRequestResult } from './useGitCloneRequest';
import type { UserMachine } from '../../types/machine';

// The folder picker is covered by its own suites. This stub keeps the Browse button inert.
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

const REPO_URL = 'https://github.com/example/hello-world.git';
const CLONE_TO = '/tmp/e2e-wizard/hello-world';
const REQUEST_ID = 'req-1' as NonNullable<UseGitCloneRequestResult['requestId']>;

const machine = {
  machineId: 'machine-1',
  hostname: 'laptop',
  os: 'darwin',
  registeredAt: 0,
} as unknown as UserMachine;

type FakeClone = UseGitCloneRequestResult;

function makeClone(
  viewState: GitCloneViewState,
  requestId: UseGitCloneRequestResult['requestId'] = null
): FakeClone {
  return {
    start: vi.fn<UseGitCloneRequestResult['start']>(),
    reset: vi.fn<UseGitCloneRequestResult['reset']>(),
    requestId,
    viewState,
  };
}

function renderForm(
  clone: FakeClone,
  { isMachineConnected = true, isCreating = false, createError = null as string | null } = {}
) {
  const onWorkspaceReady = vi.fn();
  const onBack = vi.fn();
  const element = (c: FakeClone) => (
    <CloneRepoForm
      machine={machine}
      isMachineConnected={isMachineConnected}
      isCreating={isCreating}
      createError={createError}
      clone={c}
      onWorkspaceReady={onWorkspaceReady}
      onBack={onBack}
    />
  );
  const utils = render(element(clone));
  return {
    ...utils,
    clone,
    onWorkspaceReady,
    onBack,
    rerenderWith: (next: FakeClone) => utils.rerender(element(next)),
  };
}

function urlInput() {
  return screen.getByRole('textbox', { name: 'Repository URL' });
}

function cloneToInput() {
  return screen.getByRole('textbox', { name: 'Clone to' });
}

function cloneButton() {
  return screen.getByRole('button', { name: 'Clone' });
}

describe('CloneRepoForm', () => {
  it.each<[string, GitCloneViewState, string]>([
    ['waiting', { kind: 'waiting', offline: false }, 'Waiting for laptop…'],
    ['waiting while offline', { kind: 'waiting', offline: true }, 'Machine appears offline.'],
    ['cloning', { kind: 'cloning', phase: 'Receiving objects', percent: 42 }, '42%'],
    ['stalled', { kind: 'stalled' }, 'No progress from laptop for 2 minutes.'],
    ['timed out', { kind: 'timed_out' }, 'The machine did not pick up the clone request.'],
    ['completed', { kind: 'completed', clonedPath: CLONE_TO }, `Cloned to ${CLONE_TO}`],
    [
      'failed',
      {
        kind: 'failed',
        errorCode: 'auth',
        message: 'Authentication failed. Check that this machine has access',
      },
      'Authentication failed. Check that this machine has access',
    ],
  ])('renders the %s state message', (_label, viewState, expectedText) => {
    renderForm(makeClone(viewState, REQUEST_ID));

    expect(screen.getByText(expectedText)).toBeTruthy();
  });

  it('renders no status panel while idle', () => {
    renderForm(makeClone({ kind: 'idle' }));

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('disables Clone for an invalid repository URL', async () => {
    const user = userEvent.setup();
    renderForm(makeClone({ kind: 'idle' }));

    await user.type(urlInput(), 'file:///etc/passwd');
    await user.type(cloneToInput(), '/tmp/e2e-wizard/hello-world');

    expect(cloneButton()).toBeDisabled();
  });

  it('disables Clone for a relative target path and enables it once the path is absolute', async () => {
    const user = userEvent.setup();
    const clone = makeClone({ kind: 'idle' });
    renderForm(clone);

    await user.type(urlInput(), REPO_URL);
    await user.type(cloneToInput(), 'relative/path');

    expect(cloneButton()).toBeDisabled();
    expect(screen.getByText('Clone to must be an absolute path starting with /.')).toBeTruthy();

    await user.clear(cloneToInput());
    await user.type(cloneToInput(), CLONE_TO);

    expect(cloneButton()).toBeEnabled();
    await user.click(cloneButton());
    expect(clone.start).toHaveBeenCalledWith('machine-1', REPO_URL, CLONE_TO);
  });

  it('disables Clone while the machine is offline', async () => {
    const user = userEvent.setup();
    renderForm(makeClone({ kind: 'idle' }), { isMachineConnected: false });

    await user.type(urlInput(), REPO_URL);
    await user.type(cloneToInput(), CLONE_TO);

    expect(cloneButton()).toBeDisabled();
  });

  it('hands the cloned path to the wizard once, even after re-renders', () => {
    const completed = { kind: 'completed' as const, clonedPath: CLONE_TO };
    const { onWorkspaceReady, rerenderWith } = renderForm(makeClone(completed, REQUEST_ID));

    expect(onWorkspaceReady).toHaveBeenCalledTimes(1);
    expect(onWorkspaceReady).toHaveBeenCalledWith(CLONE_TO);

    rerenderWith(makeClone(completed, REQUEST_ID));
    rerenderWith(makeClone(completed, REQUEST_ID));

    expect(onWorkspaceReady).toHaveBeenCalledTimes(1);
  });

  it('offers Create chatroom after a completed clone, so a failed creation can be retried', async () => {
    const user = userEvent.setup();
    const { onWorkspaceReady } = renderForm(
      makeClone({ kind: 'completed', clonedPath: CLONE_TO }, REQUEST_ID)
    );
    expect(onWorkspaceReady).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Create chatroom' }));

    expect(onWorkspaceReady).toHaveBeenCalledTimes(2);
    expect(onWorkspaceReady).toHaveBeenLastCalledWith(CLONE_TO);
  });

  it('disables the retry and labels it Creating… while the wizard is creating', () => {
    renderForm(makeClone({ kind: 'completed', clonedPath: CLONE_TO }, REQUEST_ID), {
      isCreating: true,
    });

    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
  });

  it('shows the clone-specific alert after a failed create, with no Try again', () => {
    renderForm(makeClone({ kind: 'completed', clonedPath: CLONE_TO }, REQUEST_ID), {
      createError: 'boom',
    });

    expect(screen.getByRole('alert').textContent).toBe(
      `Cloned to ${CLONE_TO}, but the chatroom could not be created: boom. The clone is kept — select Create chatroom to try again.`
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('shows no alert for a completed clone without a create error', () => {
    renderForm(makeClone({ kind: 'completed', clonedPath: CLONE_TO }, REQUEST_ID));

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not hand off a path before the clone completes', () => {
    const { onWorkspaceReady } = renderForm(
      makeClone({ kind: 'cloning', phase: 'Receiving objects', percent: 10 }, REQUEST_ID)
    );

    expect(onWorkspaceReady).not.toHaveBeenCalled();
  });

  it.each<[string, GitCloneViewState]>([
    ['failed', { kind: 'failed', errorCode: 'auth', message: 'Authentication failed.' }],
    ['stalled', { kind: 'stalled' }],
    ['timed out', { kind: 'timed_out' }],
  ])('"Try again" resets the clone after a %s result', async (_label, viewState) => {
    const user = userEvent.setup();
    const clone = makeClone(viewState, REQUEST_ID);
    renderForm(clone);

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(clone.reset).toHaveBeenCalledTimes(1);
  });

  it('keeps the entered inputs when a clone fails', () => {
    renderForm(
      makeClone(
        { kind: 'failed', errorCode: 'auth', message: 'Authentication failed.' },
        REQUEST_ID
      )
    );

    expect(urlInput()).toBeEnabled();
    expect(cloneToInput()).toBeEnabled();
  });

  it('Back calls onBack while idle and is disabled while a clone runs', async () => {
    const user = userEvent.setup();
    const idle = renderForm(makeClone({ kind: 'idle' }));

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(idle.onBack).toHaveBeenCalledTimes(1);

    idle.unmount();
    renderForm(makeClone({ kind: 'cloning', phase: 'Receiving objects', percent: 10 }, REQUEST_ID));

    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    expect(urlInput()).toBeDisabled();
  });
});

describe('CloneRepoForm shared footer', () => {
  it('keeps Clone in the step footer and starts the clone through the form attribute', async () => {
    const user = userEvent.setup();
    const clone = makeClone({ kind: 'idle' });
    renderForm(clone);

    await user.type(urlInput(), REPO_URL);
    await user.type(cloneToInput(), CLONE_TO);
    const submit = cloneButton();

    expect(submit.closest('[data-slot="setup-step-footer"]')).not.toBeNull();
    await user.click(submit);
    expect(clone.start).toHaveBeenCalledWith('machine-1', REPO_URL, CLONE_TO);
  });

  it('keeps Back in the step footer, disabled while a clone is locked', () => {
    renderForm(makeClone({ kind: 'cloning', phase: 'Receiving objects', percent: 10 }, REQUEST_ID));

    const back = screen.getByRole('button', { name: 'Back' });
    expect(back.closest('[data-slot="setup-step-footer"]')).not.toBeNull();
    expect(back).toBeDisabled();
  });
});
