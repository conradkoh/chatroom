/**
 * Unit tests for patchWorkspaceGitState (unit-row, change-driven git state writes).
 *
 * Each test uses its own machineId/workingDir: the test DB is shared across tests in this file.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { patchWorkspaceGitState } from './patch-workspace-git-state';
import { findUnitRow } from './workspace-git-unit-rows';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';
import type { WorkspaceGitStateUnit } from '../../entities/workspace-git-state-unit';

const NOW = 1_800_000_000_000;

interface Target {
  machineId: string;
  workingDir: string;
}

async function createSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId, userId: login.userId as Id<'users'> };
}

async function createChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Test Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
}

async function registerWorkspace(sessionId: SessionId, target: Target) {
  const chatroomId = await createChatroom(sessionId);
  return t.mutation(api.workspaces.registerWorkspace, {
    sessionId,
    chatroomId,
    machineId: target.machineId,
    workingDir: target.workingDir,
    hostname: 'test-host',
    registeredBy: 'user',
  });
}

/** Registers a machine and an active workspace for a fresh target; returns the target and workspace id. */
async function setupWorkspace(suffix: string) {
  const { sessionId } = await createSession(`patch-git-${suffix}`);
  const target: Target = {
    machineId: `patch-git-machine-${suffix}`,
    workingDir: `/tmp/patch-git-${suffix}`,
  };
  await t.mutation(api.machines.register, {
    sessionId,
    machineId: target.machineId,
    hostname: 'test-host',
    os: 'linux',
    availableHarnesses: ['opencode'],
  });
  const workspaceId = await registerWorkspace(sessionId, target);
  return { sessionId, workspaceId, target };
}

function patch(target: Target, unit: WorkspaceGitStateUnit, now = NOW) {
  return t.run(async (ctx) => patchWorkspaceGitState(ctx, { ...target, unit, now }));
}

/** Reads every unit row for the target via the production lookup. */
async function readUnitRows(target: Target) {
  return t.run(async (ctx) => ({
    head: await findUnitRow(ctx, 'head', target),
    worktree: await findUnitRow(ctx, 'worktree', target),
    upstream: await findUnitRow(ctx, 'upstream', target),
    remotes: await findUnitRow(ctx, 'remotes', target),
    pullRequests: await findUnitRow(ctx, 'pullRequests', target),
    checks: await findUnitRow(ctx, 'checks', target),
  }));
}

/** Reads the legacy blob row for the target, if any. */
async function readBlobRow(target: Target) {
  return t.run(async (ctx) =>
    ctx.db
      .query('chatroom_workspaceGitState')
      .withIndex('by_machine_workingDir', (q) =>
        q.eq('machineId', target.machineId).eq('workingDir', target.workingDir)
      )
      .first()
  );
}

const WORKTREE_UNIT: WorkspaceGitStateUnit = {
  kind: 'worktree',
  isDirty: true,
  diffStat: { filesChanged: 1, insertions: 2, deletions: 0 },
};

const UNITS: { kind: WorkspaceGitStateUnit['kind']; unit: WorkspaceGitStateUnit }[] = [
  { kind: 'head', unit: { kind: 'head', status: 'available', branch: 'main' } },
  { kind: 'worktree', unit: WORKTREE_UNIT },
  { kind: 'upstream', unit: { kind: 'upstream', commitsAhead: 1, commitsBehind: 2 } },
  {
    kind: 'remotes',
    unit: { kind: 'remotes', remotes: [{ name: 'origin', url: 'https://example.test/repo.git' }] },
  },
  {
    kind: 'pullRequests',
    unit: {
      kind: 'pullRequests',
      openPullRequests: [
        {
          prNumber: 7,
          title: 'Fix',
          url: 'https://example.test/7',
          headRefName: 'fix',
          state: 'OPEN',
        },
      ],
    },
  },
  { kind: 'checks', unit: { kind: 'checks', headCommitStatus: null } },
];

describe('patchWorkspaceGitState', () => {
  test('first write inserts a row for its kind only and never the blob', async () => {
    const { target } = await setupWorkspace('insert');

    const result = await patch(target, { kind: 'head', status: 'available', branch: 'main' });

    expect(result).toEqual({ applied: true });
    const rows = await readUnitRows(target);
    expect(rows.head).toMatchObject({
      machineId: target.machineId,
      workingDir: target.workingDir,
      status: 'available',
      branch: 'main',
      updatedAt: NOW,
    });
    expect(rows.worktree).toBeNull();
    expect(rows.upstream).toBeNull();
    expect(rows.remotes).toBeNull();
    expect(rows.pullRequests).toBeNull();
    expect(rows.checks).toBeNull();
    expect(await readBlobRow(target)).toBeNull();
  });

  test('identical unit produces no write (updatedAt and _id unchanged)', async () => {
    const { target } = await setupWorkspace('identical');
    await patch(target, { kind: 'head', status: 'available', branch: 'main' });
    const before = (await readUnitRows(target)).head;

    const result = await patch(
      target,
      { kind: 'head', status: 'available', branch: 'main' },
      NOW + 5_000
    );

    expect(result).toEqual({ applied: false, reason: 'unchanged' });
    const after = (await readUnitRows(target)).head;
    expect(after!._id).toBe(before!._id);
    expect(after!.updatedAt).toBe(NOW);
  });

  test('structurally equal object with different key order is unchanged', async () => {
    const { target } = await setupWorkspace('key-order');
    await patch(target, {
      kind: 'worktree',
      isDirty: false,
      diffStat: { filesChanged: 1, insertions: 2, deletions: 3 },
    });

    const result = await patch(target, {
      kind: 'worktree',
      isDirty: false,
      diffStat: { deletions: 3, insertions: 2, filesChanged: 1 },
    });

    expect(result).toEqual({ applied: false, reason: 'unchanged' });
  });

  test('changed unit is applied, moves updatedAt, and replaces the row', async () => {
    const { target } = await setupWorkspace('changed');
    await patch(target, { kind: 'head', status: 'available', branch: 'main' });
    const before = (await readUnitRows(target)).head;

    const result = await patch(
      target,
      { kind: 'head', status: 'available', branch: 'feature' },
      NOW + 5_000
    );

    expect(result).toEqual({ applied: true });
    const after = (await readUnitRows(target)).head;
    expect(after!.branch).toBe('feature');
    expect(after!.updatedAt).toBe(NOW + 5_000);
    expect(after!._id).toBe(before!._id);
  });

  test.each(UNITS)('writes only the $kind table', async ({ kind, unit }) => {
    const { target } = await setupWorkspace(`only-${kind}`);

    const result = await patch(target, unit);

    expect(result).toEqual({ applied: true });
    const rows = await readUnitRows(target);
    for (const [rowKind, row] of Object.entries(rows)) {
      if (rowKind === kind) expect(row).not.toBeNull();
      else expect(row).toBeNull();
    }
  });

  test('head error to available clears errorMessage', async () => {
    const { target } = await setupWorkspace('clear-error');
    await patch(target, { kind: 'head', status: 'error', errorMessage: 'boom' });

    const result = await patch(target, { kind: 'head', status: 'available', branch: 'main' });

    expect(result).toEqual({ applied: true });
    const head = (await readUnitRows(target)).head;
    expect(head).toMatchObject({ status: 'available', branch: 'main' });
    expect(head!.errorMessage).toBeUndefined();
  });

  test('head available to not_found clears branch', async () => {
    const { target } = await setupWorkspace('clear-branch');
    await patch(target, { kind: 'head', status: 'available', branch: 'main' });

    const result = await patch(target, { kind: 'head', status: 'not_found' });

    expect(result).toEqual({ applied: true });
    const head = (await readUnitRows(target)).head;
    expect(head).toMatchObject({ status: 'not_found' });
    expect(head!.branch).toBeUndefined();
  });

  test('non-head unit is stored without creating a head row', async () => {
    const { target } = await setupWorkspace('non-head');

    const result = await patch(target, WORKTREE_UNIT);

    expect(result).toEqual({ applied: true });
    const rows = await readUnitRows(target);
    expect(rows.head).toBeNull();
    expect(rows.worktree).toMatchObject({ isDirty: true });
  });

  test('inactive workspace returns workspace_inactive and writes no row', async () => {
    const { sessionId, workspaceId, target } = await setupWorkspace('inactive');
    await t.mutation(api.workspaces.removeWorkspace, { sessionId, workspaceId });

    const result = await patch(target, { kind: 'head', status: 'available', branch: 'main' });

    expect(result).toEqual({ applied: false, reason: 'workspace_inactive' });
    const rows = await readUnitRows(target);
    for (const row of Object.values(rows)) expect(row).toBeNull();
  });

  test('writes when another active workspace row exists for the same directory', async () => {
    const { sessionId } = await createSession('patch-git-two-rows');
    const target: Target = {
      machineId: 'patch-git-machine-two-rows',
      workingDir: '/tmp/patch-git-two-rows',
    };
    await t.mutation(api.machines.register, {
      sessionId,
      machineId: target.machineId,
      hostname: 'test-host',
      os: 'linux',
      availableHarnesses: ['opencode'],
    });

    // First workspace is registered then removed, leaving a removed row for the directory.
    const removedWorkspaceId = await registerWorkspace(sessionId, target);
    await t.mutation(api.workspaces.removeWorkspace, {
      sessionId,
      workspaceId: removedWorkspaceId,
    });

    // A second workspace is registered for the same directory and stays active.
    await registerWorkspace(sessionId, target);

    const result = await patch(target, { kind: 'head', status: 'available', branch: 'main' });

    expect(result).toEqual({ applied: true });
    expect((await readUnitRows(target)).head).toMatchObject({ branch: 'main' });
  });
});
