/**
 * upsertWorkspaceGitState — recent commits cache sync tests.
 *
 * The workspace git panel reads chatroom_workspaceRecentCommits, while daemon
 * heartbeats and manual git refreshes write through upsertWorkspaceGitState.
 * These tests ensure that git state pushes keep the recent commits cache fresh.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';

const WORKING_DIR = '/tmp/upsert-git-state-recent-commits-spec';

const INITIAL_COMMITS = [
  {
    sha: '1111111111111111111111111111111111111111',
    shortSha: '1111111',
    message: 'feat: initial state',
    author: 'alice',
    date: '2024-01-01T00:00:00Z',
  },
  {
    sha: '2222222222222222222222222222222222222222',
    shortSha: '2222222',
    message: 'fix: prior bug',
    author: 'bob',
    date: '2024-01-02T00:00:00Z',
  },
];

const UPDATED_COMMITS = [
  {
    sha: '3333333333333333333333333333333333333333',
    shortSha: '3333333',
    message: 'chore: refreshed head',
    author: 'charlie',
    date: '2024-01-03T00:00:00Z',
  },
];

async function readRecentCommitsRow(machineId: string) {
  return await t.run(async (ctx) => {
    return await ctx.db
      .query('chatroom_workspaceRecentCommits')
      .withIndex('by_machine_workingDir', (q) =>
        q.eq('machineId', machineId).eq('workingDir', WORKING_DIR)
      )
      .first();
  });
}

describe('upsertWorkspaceGitState — recent commits cache sync', () => {
  test('insert path writes git state commits to the recent commits cache', async () => {
    const { sessionId } = await createTestSession('upsert-git-state-recent-insert');
    const machineId = 'upsert-git-state-recent-insert-machine';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.mutation(api.workspaces.upsertWorkspaceGitState, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
      status: 'available',
      branch: 'main',
      isDirty: false,
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
      recentCommits: INITIAL_COMMITS,
      hasMoreCommits: true,
    });

    const result = await t.query(api.workspaces.getRecentCommits, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
    });

    expect(result).not.toBeNull();
    expect(result!.commits).toEqual(INITIAL_COMMITS);
    expect(result!.hasMoreCommits).toBe(true);
  });

  test('patch path updates existing recent commits cache row', async () => {
    const { sessionId } = await createTestSession('upsert-git-state-recent-patch');
    const machineId = 'upsert-git-state-recent-patch-machine';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.mutation(api.workspaces.upsertWorkspaceGitState, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
      status: 'available',
      branch: 'main',
      isDirty: false,
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
      recentCommits: INITIAL_COMMITS,
      hasMoreCommits: true,
    });

    await t.run(async (ctx) => {
      const row = await ctx.db
        .query('chatroom_workspaceRecentCommits')
        .withIndex('by_machine_workingDir', (q) =>
          q.eq('machineId', machineId).eq('workingDir', WORKING_DIR)
        )
        .first();
      if (!row) throw new Error('expected recent commits row');
      await ctx.db.patch(row._id, { updatedAt: 1 });
    });

    await t.mutation(api.workspaces.upsertWorkspaceGitState, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
      status: 'available',
      branch: 'main',
      isDirty: true,
      diffStat: { filesChanged: 1, insertions: 2, deletions: 3 },
      recentCommits: UPDATED_COMMITS,
      hasMoreCommits: false,
    });

    const result = await t.query(api.workspaces.getRecentCommits, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
    });

    expect(result).not.toBeNull();
    expect(result!.commits).toEqual(UPDATED_COMMITS);
    expect(result!.hasMoreCommits).toBe(false);
    expect(result!.updatedAt).not.toBe(1);
  });

  test('non-available status does not create recent commits cache rows', async () => {
    const { sessionId } = await createTestSession('upsert-git-state-recent-non-available');
    const notFoundMachineId = 'upsert-git-state-recent-not-found-machine';
    const errorMachineId = 'upsert-git-state-recent-error-machine';
    await registerMachineWithDaemon(sessionId, notFoundMachineId);
    await registerMachineWithDaemon(sessionId, errorMachineId);

    await t.mutation(api.workspaces.upsertWorkspaceGitState, {
      sessionId: sessionId as any,
      machineId: notFoundMachineId,
      workingDir: WORKING_DIR,
      status: 'not_found',
      recentCommits: INITIAL_COMMITS,
      hasMoreCommits: true,
    });

    await t.mutation(api.workspaces.upsertWorkspaceGitState, {
      sessionId: sessionId as any,
      machineId: errorMachineId,
      workingDir: WORKING_DIR,
      status: 'error',
      errorMessage: 'git unavailable',
      recentCommits: INITIAL_COMMITS,
      hasMoreCommits: true,
    });

    expect(await readRecentCommitsRow(notFoundMachineId)).toBeNull();
    expect(await readRecentCommitsRow(errorMachineId)).toBeNull();
  });

  test('non-available status does not touch existing recent commits cache row', async () => {
    const { sessionId } = await createTestSession('upsert-git-state-recent-untouched');
    const machineId = 'upsert-git-state-recent-untouched-machine';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.mutation(api.workspaces.upsertRecentCommits, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
      commits: INITIAL_COMMITS,
      hasMoreCommits: true,
    });

    const existing = await readRecentCommitsRow(machineId);
    expect(existing).not.toBeNull();

    await t.run(async (ctx) => {
      await ctx.db.patch(existing!._id, { updatedAt: 1 });
    });

    await t.mutation(api.workspaces.upsertWorkspaceGitState, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
      status: 'error',
      errorMessage: 'git unavailable',
      recentCommits: UPDATED_COMMITS,
      hasMoreCommits: false,
    });

    const result = await t.query(api.workspaces.getRecentCommits, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
    });

    expect(result).not.toBeNull();
    expect(result!.commits).toEqual(INITIAL_COMMITS);
    expect(result!.hasMoreCommits).toBe(true);
    expect(result!.updatedAt).toBe(1);
  });
});
