/**
 * Split-write isolation tests.
 *
 * After the refactor in release/v1.38.3, gitState and recentCommits are written
 * through two separate mutations:
 *
 *   - upsertWorkspaceGitState  → chatroom_workspaceGitState only
 *   - upsertRecentCommits      → chatroom_workspaceRecentCommits only
 *
 * These tests assert that neither mutation crosses table boundaries.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';

const WORKING_DIR = '/tmp/git-state-split-spec';

const SAMPLE_COMMITS = [
  {
    sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    shortSha: 'aaaaaaa',
    message: 'feat: split write',
    author: 'alice',
    date: '2024-01-01T00:00:00Z',
  },
];

describe('split-write isolation', () => {
  test('upsertWorkspaceGitState does NOT touch chatroom_workspaceRecentCommits', async () => {
    const { sessionId } = await createTestSession('split-write-gitstate-isolation');
    const machineId = 'split-write-gitstate-isolation-machine';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.mutation(api.workspaces.upsertWorkspaceGitState, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
      status: 'available',
      branch: 'main',
      isDirty: false,
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
    });

    const recentCommitsRow = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_workspaceRecentCommits')
        .withIndex('by_machine_workingDir', (q) =>
          q.eq('machineId', machineId).eq('workingDir', WORKING_DIR)
        )
        .first();
    });

    expect(recentCommitsRow).toBeNull();
  });

  test('upsertRecentCommits does NOT modify chatroom_workspaceGitState fields', async () => {
    const { sessionId } = await createTestSession('split-write-commits-isolation');
    const machineId = 'split-write-commits-isolation-machine';
    await registerMachineWithDaemon(sessionId, machineId);

    // Establish a known gitState row
    await t.mutation(api.workspaces.upsertWorkspaceGitState, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
      status: 'available',
      branch: 'feat/split',
      isDirty: true,
      diffStat: { filesChanged: 3, insertions: 10, deletions: 2 },
    });

    const beforeGitState = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_workspaceGitState')
        .withIndex('by_machine_workingDir', (q) =>
          q.eq('machineId', machineId).eq('workingDir', WORKING_DIR)
        )
        .first();
    });
    expect(beforeGitState).not.toBeNull();

    // Now call upsertRecentCommits
    await t.mutation(api.workspaces.upsertRecentCommits, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
      commits: SAMPLE_COMMITS,
      hasMoreCommits: false,
    });

    const afterGitState = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_workspaceGitState')
        .withIndex('by_machine_workingDir', (q) =>
          q.eq('machineId', machineId).eq('workingDir', WORKING_DIR)
        )
        .first();
    });

    // chatroom_workspaceGitState should not have been modified by upsertRecentCommits
    expect(afterGitState).not.toBeNull();
    expect(afterGitState!.branch).toBe('feat/split');
    expect(afterGitState!.isDirty).toBe(true);
    expect(afterGitState!.updatedAt).toBe(beforeGitState!.updatedAt);
  });

  test('upsertRecentCommits correctly persists commits independently', async () => {
    const { sessionId } = await createTestSession('split-write-commits-persist');
    const machineId = 'split-write-commits-persist-machine';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.mutation(api.workspaces.upsertRecentCommits, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
      commits: SAMPLE_COMMITS,
      hasMoreCommits: true,
    });

    const result = await t.query(api.workspaces.getRecentCommits, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
    });

    expect(result).not.toBeNull();
    expect(result!.commits).toEqual(SAMPLE_COMMITS);
    expect(result!.hasMoreCommits).toBe(true);
  });
});
