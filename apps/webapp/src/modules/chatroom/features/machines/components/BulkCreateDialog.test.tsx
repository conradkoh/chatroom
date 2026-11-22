import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FunctionReference } from 'convex/server';
import { getFunctionName } from 'convex/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BulkCreateDialog } from './BulkCreateDialog';

const mocks = vi.hoisted(() => ({
  createMany: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: (mutation: unknown) => {
    const name = getFunctionName(mutation as FunctionReference<'mutation'>);
    if (name !== 'chatrooms:createManyWithWorkspace') {
      throw new Error(`Unexpected mutation: ${name}`);
    }
    return mocks.createMany;
  },
}));

const REPO_PATHS = Array.from(
  { length: 120 },
  (_, index) => `/Users/me/projects/repo-${String(index).padStart(3, '0')}`
);

const INVALID_WORKING_DIR_COPY =
  "That path isn't valid. Use an absolute folder path such as /Users/you/projects.";

function renderDialog(overrides: Partial<{ paths: string[]; onClose: () => void }> = {}) {
  const onClose = overrides.onClose ?? vi.fn();
  const utils = render(
    <BulkCreateDialog
      machineId="m-1"
      displayName="Studio Mac"
      paths={overrides.paths ?? REPO_PATHS}
      onClose={onClose}
    />
  );
  return { onClose, ...utils };
}

describe('BulkCreateDialog', () => {
  beforeEach(() => {
    mocks.createMany.mockReset();
  });

  it('lists the first 50 targets and explains the default team', () => {
    renderDialog();

    const paths = screen.getAllByTestId('bulk-create-path');
    expect(paths).toHaveLength(50);
    expect(paths[0].textContent).toBe('/Users/me/projects/repo-000');
    expect(paths[49].textContent).toBe('/Users/me/projects/repo-049');

    const dialog = screen.getByTestId('bulk-create-dialog');
    expect(dialog.textContent).toContain('on “Studio Mac” using the default team');
    expect(dialog.textContent).toContain('No agents are started');
    expect(dialog.textContent).toContain('already have a chatroom are skipped');
    expect(dialog.textContent).toContain(
      '50 of 120 repositories will be created now. You can create the next 70 afterwards.'
    );
    expect(screen.getByTestId('bulk-create-confirm').textContent).toBe('Create 50 chatrooms');
  });

  it('closes on Cancel without calling the mutation', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.createMany).not.toHaveBeenCalled();
  });

  it('stays open when Escape is pressed while creating', async () => {
    const user = userEvent.setup();
    mocks.createMany.mockReturnValue(new Promise(() => undefined));
    const { onClose } = renderDialog();

    await user.click(screen.getByTestId('bulk-create-confirm'));

    expect(await screen.findByTestId('bulk-create-pending')).toBeDefined();
    await user.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('bulk-create-pending')).toBeDefined();
  });

  it('reports counts, mapped failure reasons, and skipped rows from the backend result', async () => {
    const user = userEvent.setup();
    const paths = ['/Users/me/projects/a', '/Users/me/projects/bad dir', '/Users/me/projects/c'];
    mocks.createMany.mockResolvedValue({
      results: [
        {
          workingDir: '/Users/me/projects/a',
          outcome: 'created',
          chatroomId: 'chat-a',
          workspaceId: 'ws-a',
        },
        {
          workingDir: '/Users/me/projects/skip',
          outcome: 'skipped',
          reason: 'already_has_chatroom',
          chatroomId: 'chat-s',
        },
        {
          workingDir: '/Users/me/projects/bad dir',
          outcome: 'failed',
          code: 'INVALID_WORKING_DIR',
          message: 'raw backend text',
        },
      ],
      created: 1,
      skipped: 1,
      failed: 1,
    });
    renderDialog({ paths });

    await user.click(screen.getByTestId('bulk-create-confirm'));

    const summary = await screen.findByTestId('bulk-create-summary');
    expect(summary.textContent).toBe('Created 1 · Skipped 1 · Failed 1');
    expect(mocks.createMany).toHaveBeenCalledWith({
      machineId: 'm-1',
      workingDirs: paths,
    });

    const failures = screen.getByTestId('bulk-create-failures');
    expect(failures.textContent).toContain(
      `/Users/me/projects/bad dir — ${INVALID_WORKING_DIR_COPY}`
    );
    expect(failures.textContent).not.toContain('raw backend text');
    expect(screen.getByTestId('bulk-create-dialog').textContent).toContain(
      '1 already had a chatroom'
    );
    expect(screen.queryByTestId('bulk-create-remaining')).toBeNull();
    expect(screen.queryByTestId('bulk-create-next')).toBeNull();
  });

  it('creates the next batch of at most 50 and keeps counting the remainder', async () => {
    const user = userEvent.setup();
    const first = { results: [], created: 50, skipped: 0, failed: 0 };
    const second = { results: [], created: 50, skipped: 0, failed: 0 };
    mocks.createMany.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    renderDialog();

    await user.click(screen.getByTestId('bulk-create-confirm'));

    expect((await screen.findByTestId('bulk-create-remaining')).textContent).toBe(
      '70 repositories still have no chatroom.'
    );
    expect(screen.getByTestId('bulk-create-next').textContent).toBe('Create next 50');

    await user.click(screen.getByTestId('bulk-create-next'));

    const secondCall = mocks.createMany.mock.calls[1][0] as {
      machineId: string;
      workingDirs: string[];
    };
    expect(secondCall.machineId).toBe('m-1');
    expect(secondCall.workingDirs).toHaveLength(50);
    expect(secondCall.workingDirs[0]).toBe('/Users/me/projects/repo-050');
    expect(secondCall.workingDirs[49]).toBe('/Users/me/projects/repo-099');

    await waitFor(() =>
      expect(screen.getByTestId('bulk-create-remaining').textContent).toBe(
        '20 repositories still have no chatroom.'
      )
    );
    expect(screen.getByTestId('bulk-create-next').textContent).toBe('Create next 20');
  });

  it('shows a retryable whole-call error and retries the same batch', async () => {
    const user = userEvent.setup();
    mocks.createMany.mockRejectedValue(new Error('network down'));
    renderDialog();

    await user.click(screen.getByTestId('bulk-create-confirm'));

    const error = await screen.findByTestId('bulk-create-error');
    expect(error.textContent).toContain('Nothing was created.');
    expect(error.textContent).toContain('It is safe to try again');
    expect(error.textContent).not.toContain('network down');
    expect(screen.queryByTestId('bulk-create-earlier')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Nothing was created');

    await user.click(screen.getByTestId('bulk-create-retry'));

    await waitFor(() => expect(mocks.createMany).toHaveBeenCalledTimes(2));
    const firstCall = mocks.createMany.mock.calls[0][0] as { workingDirs: string[] };
    const retryCall = mocks.createMany.mock.calls[1][0] as { workingDirs: string[] };
    expect(retryCall.workingDirs).toEqual(firstCall.workingDirs);
    expect(retryCall.workingDirs).toHaveLength(50);
    expect(retryCall.workingDirs[0]).toBe('/Users/me/projects/repo-000');
    expect(retryCall.workingDirs[49]).toBe('/Users/me/projects/repo-049');
  });

  it('keeps the cumulative summary inline and closes only on Done', async () => {
    const user = userEvent.setup();
    mocks.createMany.mockResolvedValue({
      results: [
        {
          workingDir: '/Users/me/projects/a',
          outcome: 'created',
          chatroomId: 'chat-a',
          workspaceId: 'ws-a',
        },
        {
          workingDir: '/Users/me/projects/skip',
          outcome: 'skipped',
          reason: 'already_has_chatroom',
          chatroomId: 'chat-s',
        },
      ],
      created: 1,
      skipped: 1,
      failed: 0,
    });
    const { onClose } = renderDialog({
      paths: ['/Users/me/projects/a', '/Users/me/projects/skip'],
    });

    await user.click(screen.getByTestId('bulk-create-confirm'));
    const summary = await screen.findByTestId('bulk-create-summary');
    expect(summary.textContent).toBe('Created 1 · Skipped 1 · Failed 0');
    expect(summary.getAttribute('role')).toBe('alert');
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the all-failed summary inline and does not close on its own', async () => {
    const user = userEvent.setup();
    const failed = (workingDir: string) => ({
      workingDir,
      outcome: 'failed' as const,
      code: 'INVALID_WORKING_DIR' as const,
      message: 'raw',
    });
    mocks.createMany.mockResolvedValue({
      results: [failed('/Users/me/projects/a'), failed('/Users/me/projects/b')],
      created: 0,
      skipped: 0,
      failed: 2,
    });
    const { onClose } = renderDialog({ paths: ['/Users/me/projects/a', '/Users/me/projects/b'] });

    await user.click(screen.getByTestId('bulk-create-confirm'));
    const summary = await screen.findByTestId('bulk-create-summary');
    expect(summary.textContent).toBe('Created 0 · Skipped 0 · Failed 2');
    expect(summary.getAttribute('role')).toBe('alert');
    expect(screen.getByTestId('bulk-create-failures').textContent).toContain(
      '/Users/me/projects/a'
    );
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
