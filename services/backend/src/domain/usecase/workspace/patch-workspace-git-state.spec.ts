/**
 * Unit tests for patchWorkspaceGitState (unit-scoped, change-driven git state writes).
 *
 * Each test uses its own machineId/workingDir: the test DB is shared across tests in this file.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { patchWorkspaceGitState } from './patch-workspace-git-state';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';
import type { WorkspaceGitStateUnit } from '../../entities/workspace-git-state-unit';

const FIXED_NOW = 1_800_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

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

/** Registers a machine and an active workspace for a fresh target; returns the target and workspace id. */
async function setupWorkspace(suffix: string) {
  const { sessionId } = await createSession(`patch-git-${suffix}`);
  const chatroomId = await createChatroom(sessionId);
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
  const workspaceId = await t.mutation(api.workspaces.registerWorkspace, {
    sessionId,
    chatroomId,
    machineId: target.machineId,
    workingDir: target.workingDir,
    hostname: 'test-host',
    registeredBy: 'user',
  });
  return { sessionId, workspaceId, target };
}

function patch(target: Target, unit: WorkspaceGitStateUnit, now = FIXED_NOW) {
  return t.run(async (ctx) => patchWorkspaceGitState(ctx, { ...target, unit, now }));
}

async function readRows(target: Target) {
  return t.run(async (ctx) =>
    ctx.db
      .query('chatroom_workspaceGitState')
      .withIndex('by_machine_workingDir', (q) =>
        q.eq('machineId', target.machineId).eq('workingDir', target.workingDir)
      )
      .collect()
  );
}

describe('patchWorkspaceGitState', () => {
  test('inserts a row on the first unit', async () => {
    const { target } = await setupWorkspace('insert');

    const result = await patch(target, { kind: 'head', status: 'available', branch: 'main' });

    expect(result).toEqual({ applied: true });
    const rows = await readRows(target);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      machineId: target.machineId,
      workingDir: target.workingDir,
      status: 'available',
      branch: 'main',
      updatedAt: FIXED_NOW,
    });
  });

  test('head-only patch leaves fields owned by other units untouched', async () => {
    const { target } = await setupWorkspace('head-only');
    await patch(target, { kind: 'upstream', commitsAhead: 2, commitsBehind: 1 });
    await patch(target, { kind: 'head', status: 'available', branch: 'main' });

    const result = await patch(target, { kind: 'head', status: 'available', branch: 'feature' });

    expect(result).toEqual({ applied: true });
    const [row] = await readRows(target);
    expect(row).toMatchObject({ branch: 'feature', commitsAhead: 2, commitsBehind: 1 });
  });

  test('non-head unit never changes status', async () => {
    const { target } = await setupWorkspace('non-head-status');
    await patch(target, { kind: 'head', status: 'error', errorMessage: 'git failed' });

    const result = await patch(target, {
      kind: 'worktree',
      isDirty: true,
      diffStat: { filesChanged: 1, insertions: 2, deletions: 0 },
    });

    expect(result).toEqual({ applied: true });
    const [row] = await readRows(target);
    expect(row).toMatchObject({ status: 'error', errorMessage: 'git failed', isDirty: true });
  });

  test('identical unit produces no write (updatedAt and _id unchanged)', async () => {
    const { target } = await setupWorkspace('identical');
    await patch(target, { kind: 'head', status: 'available', branch: 'main' }, FIXED_NOW);
    const [before] = await readRows(target);

    const later = FIXED_NOW + 5_000;
    vi.setSystemTime(later);
    const result = await patch(
      target,
      { kind: 'head', status: 'available', branch: 'main' },
      later
    );

    expect(result).toEqual({ applied: false, reason: 'unchanged' });
    const [after] = await readRows(target);
    expect(after!._id).toBe(before!._id);
    expect(after!.updatedAt).toBe(FIXED_NOW);
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

  test('error to available clears errorMessage', async () => {
    const { target } = await setupWorkspace('clear-error');
    await patch(target, { kind: 'head', status: 'error', errorMessage: 'boom' });

    const result = await patch(target, { kind: 'head', status: 'available', branch: 'main' });

    expect(result).toEqual({ applied: true });
    const [row] = await readRows(target);
    expect(row).toMatchObject({ status: 'available', branch: 'main' });
    expect(row!.errorMessage).toBeUndefined();
  });

  test('legacy number-only PR rows compare equal after normalization', async () => {
    const { target } = await setupWorkspace('legacy-pr');
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceGitState', {
        machineId: target.machineId,
        workingDir: target.workingDir,
        status: 'available',
        openPullRequests: [
          {
            number: 7,
            title: 'Fix',
            url: 'https://example.test/7',
            headRefName: 'fix',
            state: 'OPEN',
          },
        ],
        updatedAt: FIXED_NOW - 1_000,
      });
    });

    const result = await patch(target, {
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
    });

    expect(result).toEqual({ applied: false, reason: 'unchanged' });
    const [row] = await readRows(target);
    expect(row!.updatedAt).toBe(FIXED_NOW - 1_000);
  });

  test('inactive workspace returns workspace_inactive and inserts no row', async () => {
    const { sessionId, workspaceId, target } = await setupWorkspace('inactive');
    await t.mutation(api.workspaces.removeWorkspace, { sessionId, workspaceId });

    const result = await patch(target, { kind: 'head', status: 'available', branch: 'main' });

    expect(result).toEqual({ applied: false, reason: 'workspace_inactive' });
    expect(await readRows(target)).toHaveLength(0);
  });
});
