/**
 * upsertWorkspaceGitState — PR field validator regression tests.
 *
 * The CLI sends `prNumber` (canonical app field), while older clients and the
 * raw gh CLI use `number`. The mutation arg validator must accept either, and
 * the handler must normalize storage to the canonical `prNumber` field.
 *
 * Regression for: "ArgumentValidationError: Object is missing the required
 * field `number`" hit by the daemon's git heartbeat push.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';

const WORKING_DIR = '/tmp/upsert-git-state-spec';

async function readWorkspaceGitState(machineId: string) {
  return await t.run(async (ctx) => {
    return await ctx.db
      .query('chatroom_workspaceGitState')
      .withIndex('by_machine_workingDir', (q) =>
        q.eq('machineId', machineId).eq('workingDir', WORKING_DIR)
      )
      .first();
  });
}

describe('upsertWorkspaceGitState — PR number field', () => {
  test('accepts prNumber (canonical CLI field) and stores it as prNumber', async () => {
    const { sessionId } = await createTestSession('upsert-pr-field-canonical');
    const machineId = 'upsert-pr-canonical';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.mutation(api.workspaces.upsertWorkspaceGitState, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
      status: 'available',
      branch: 'main',
      isDirty: false,
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
      recentCommits: [],
      hasMoreCommits: false,
      openPullRequests: [
        {
          prNumber: 42,
          title: 'open pr',
          url: 'https://example.test/pulls/42',
          headRefName: 'main',
          state: 'OPEN',
        },
      ],
      allPullRequests: [
        {
          prNumber: 99,
          title: 'all pr',
          url: 'https://example.test/pulls/99',
          headRefName: 'feat/x',
          state: 'MERGED',
        },
      ],
    });

    const stored = await readWorkspaceGitState(machineId);
    expect(stored?.openPullRequests?.[0]?.prNumber).toBe(42);
    expect(stored?.allPullRequests?.[0]?.prNumber).toBe(99);
  });

  test('accepts legacy `number` field and normalizes it to `prNumber` on storage', async () => {
    const { sessionId } = await createTestSession('upsert-pr-field-legacy');
    const machineId = 'upsert-pr-legacy';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.mutation(api.workspaces.upsertWorkspaceGitState, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
      status: 'available',
      branch: 'main',
      isDirty: false,
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
      recentCommits: [],
      hasMoreCommits: false,
      openPullRequests: [
        {
          number: 7,
          title: 'open pr (legacy)',
          url: 'https://example.test/pulls/7',
          headRefName: 'main',
          state: 'OPEN',
        },
      ],
      allPullRequests: [
        {
          number: 8,
          title: 'all pr (legacy)',
          url: 'https://example.test/pulls/8',
          headRefName: 'feat/legacy',
          state: 'CLOSED',
        },
      ],
    });

    const stored = await readWorkspaceGitState(machineId);
    expect(stored?.openPullRequests?.[0]?.prNumber).toBe(7);
    expect(stored?.allPullRequests?.[0]?.prNumber).toBe(8);
  });

  test('getWorkspaceGitState normalizes legacy `number`-only allPullRequests rows on read', async () => {
    const { sessionId } = await createTestSession('upsert-pr-field-allprs-legacy');
    const machineId = 'upsert-pr-allprs-legacy';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceGitState', {
        machineId,
        workingDir: WORKING_DIR,
        status: 'available',
        branch: 'main',
        isDirty: false,
        diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
        recentCommits: [],
        hasMoreCommits: false,
        openPullRequests: [],
        allPullRequests: [
          {
            number: 55,
            title: 'legacy all pr',
            url: 'https://example.test/pulls/55',
            headRefName: 'feat/legacy-allprs',
            state: 'MERGED',
          },
        ],
        remotes: [],
        commitsAhead: 0,
        defaultBranch: 'main',
        headCommitStatus: null,
        defaultBranchStatus: null,
        updatedAt: Date.now(),
      });
    });

    const result = await t.query(api.workspaces.getWorkspaceGitState, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
    });

    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error('expected available');
    expect(result.allPullRequests).toHaveLength(1);
    expect(result.allPullRequests[0].prNumber).toBe(55);
    expect(result.allPullRequests[0].title).toBe('legacy all pr');
  });
});
