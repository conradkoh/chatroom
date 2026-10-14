/**
 * Split-write isolation tests.
 *
 * Git state and recent commits are written through two separate mutations:
 *
 *   - patchWorkspaceGitState → the per-unit git state tables
 *   - upsertRecentCommits   → chatroom_workspaceRecentCommits only
 *
 * These tests assert that neither mutation crosses table boundaries.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { findUnitRow } from '../../src/domain/usecase/workspace/workspace-git-unit-rows';
import { t } from '../../test.setup';
import {
  createTestSession,
  createDuoTeamChatroom,
  registerMachineWithDaemon,
} from '../helpers/integration';

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

async function registerWorkspace(sessionId: SessionId, machineId: string) {
  const chatroomId = await createDuoTeamChatroom(sessionId);
  return t.mutation(api.workspaces.registerWorkspace, {
    sessionId,
    chatroomId,
    machineId,
    workingDir: WORKING_DIR,
    hostname: 'test-host',
    registeredBy: 'test',
  });
}

describe('split-write isolation', () => {
  test('patchWorkspaceGitState does NOT touch chatroom_workspaceRecentCommits', async () => {
    const { sessionId } = await createTestSession('split-write-gitstate-isolation');
    const machineId = 'split-write-gitstate-isolation-machine';
    await registerMachineWithDaemon(sessionId, machineId);
    await registerWorkspace(sessionId, machineId);

    await t.mutation(api.workspaces.patchWorkspaceGitState, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      unit: { kind: 'head', status: 'available', branch: 'main' },
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

  test('upsertRecentCommits does NOT modify any unit row', async () => {
    const { sessionId } = await createTestSession('split-write-commits-isolation');
    const machineId = 'split-write-commits-isolation-machine';
    await registerMachineWithDaemon(sessionId, machineId);
    await registerWorkspace(sessionId, machineId);

    // Establish known per-unit rows.
    await t.mutation(api.workspaces.patchWorkspaceGitState, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      unit: { kind: 'head', status: 'available', branch: 'feat/split' },
    });
    await t.mutation(api.workspaces.patchWorkspaceGitState, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      unit: {
        kind: 'worktree',
        isDirty: true,
        diffStat: { filesChanged: 3, insertions: 10, deletions: 2 },
      },
    });

    const before = await t.run(async (ctx) => ({
      head: await findUnitRow(ctx, 'head', { machineId, workingDir: WORKING_DIR }),
      worktree: await findUnitRow(ctx, 'worktree', { machineId, workingDir: WORKING_DIR }),
    }));
    expect(before.head).not.toBeNull();
    expect(before.worktree).not.toBeNull();

    await t.mutation(api.workspaces.upsertRecentCommits, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      commits: SAMPLE_COMMITS,
      hasMoreCommits: false,
    });

    const after = await t.run(async (ctx) => ({
      head: await findUnitRow(ctx, 'head', { machineId, workingDir: WORKING_DIR }),
      worktree: await findUnitRow(ctx, 'worktree', { machineId, workingDir: WORKING_DIR }),
    }));

    // The unit rows must be untouched by upsertRecentCommits.
    expect(after.head!.updatedAt).toBe(before.head!.updatedAt);
    expect(after.head!.branch).toBe('feat/split');
    expect(after.worktree!.updatedAt).toBe(before.worktree!.updatedAt);
    expect(after.worktree!.isDirty).toBe(true);
  });

  test('upsertRecentCommits correctly persists commits independently', async () => {
    const { sessionId } = await createTestSession('split-write-commits-persist');
    const machineId = 'split-write-commits-persist-machine';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.mutation(api.workspaces.upsertRecentCommits, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      commits: SAMPLE_COMMITS,
      hasMoreCommits: true,
    });

    const result = await t.query(api.workspaces.getRecentCommits, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
    });

    expect(result).not.toBeNull();
    expect(result!.commits).toEqual(SAMPLE_COMMITS);
    expect(result!.hasMoreCommits).toBe(true);
  });
});
