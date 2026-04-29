/**
 * requestRecentCommits / upsertRecentCommits / getRecentCommits — integration tests.
 *
 * Covers idempotency, replace-not-append storage, query behavior, and
 * no-existing-row handling for on-demand recent commits fetching.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';

const WORKING_DIR = '/tmp/recent-commits-spec';

const TEST_COMMITS = [
  {
    sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    shortSha: 'aaaaaaa',
    message: 'feat: initial commit',
    author: 'alice',
    date: '2024-01-01T00:00:00Z',
  },
  {
    sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    shortSha: 'bbbbbbb',
    message: 'fix: typo',
    author: 'bob',
    date: '2024-01-02T00:00:00Z',
  },
];

describe('recentCommits on-demand APIs', () => {
  test('requestRecentCommits creates a pending diff request', async () => {
    const { sessionId } = await createTestSession('recent-commits-request');
    const machineId = 'recent-commits-request-machine';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.mutation(api.workspaces.requestRecentCommits, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
    });

    const requests = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_workspaceDiffRequests')
        .withIndex('by_machine_workingDir_type_status', (q) =>
          q
            .eq('machineId', machineId)
            .eq('workingDir', WORKING_DIR)
            .eq('requestType', 'recent_commits')
            .eq('status', 'pending')
        )
        .collect();
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]!.status).toBe('pending');
    expect(requests[0]!.requestType).toBe('recent_commits');
  });

  test('requestRecentCommits is idempotent — does not duplicate pending requests', async () => {
    const { sessionId } = await createTestSession('recent-commits-idempotent');
    const machineId = 'recent-commits-idempotent-machine';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.mutation(api.workspaces.requestRecentCommits, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
    });

    await t.mutation(api.workspaces.requestRecentCommits, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
    });

    const requests = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_workspaceDiffRequests')
        .withIndex('by_machine_workingDir_type_status', (q) =>
          q
            .eq('machineId', machineId)
            .eq('workingDir', WORKING_DIR)
            .eq('requestType', 'recent_commits')
            .eq('status', 'pending')
        )
        .collect();
    });

    expect(requests).toHaveLength(1);
  });

  test('upsertRecentCommits stores commits and getRecentCommits retrieves them', async () => {
    const { sessionId } = await createTestSession('recent-commits-upsert');
    const machineId = 'recent-commits-upsert-machine';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.mutation(api.workspaces.upsertRecentCommits, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
      commits: TEST_COMMITS,
      hasMoreCommits: true,
    });

    const result = await t.query(api.workspaces.getRecentCommits, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
    });

    expect(result).not.toBeNull();
    expect(result!.commits).toHaveLength(2);
    expect(result!.commits[0]!.sha).toBe(TEST_COMMITS[0]!.sha);
    expect(result!.commits[1]!.message).toBe('fix: typo');
    expect(result!.hasMoreCommits).toBe(true);
  });

  test('upsertRecentCommits replaces existing commits (not appends)', async () => {
    const { sessionId } = await createTestSession('recent-commits-replace');
    const machineId = 'recent-commits-replace-machine';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.mutation(api.workspaces.upsertRecentCommits, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
      commits: TEST_COMMITS,
      hasMoreCommits: true,
    });

    const replacementCommits = [
      {
        sha: 'cccccccccccccccccccccccccccccccccccccccc',
        shortSha: 'ccccccc',
        message: 'chore: cleanup',
        author: 'charlie',
        date: '2024-01-03T00:00:00Z',
      },
    ];

    await t.mutation(api.workspaces.upsertRecentCommits, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
      commits: replacementCommits,
      hasMoreCommits: false,
    });

    const result = await t.query(api.workspaces.getRecentCommits, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
    });

    expect(result).not.toBeNull();
    expect(result!.commits).toHaveLength(1);
    expect(result!.commits[0]!.sha).toBe('cccccccccccccccccccccccccccccccccccccccc');
    expect(result!.hasMoreCommits).toBe(false);
  });

  test('getRecentCommits returns null when no data exists', async () => {
    const { sessionId } = await createTestSession('recent-commits-empty');
    const machineId = 'recent-commits-empty-machine';
    await registerMachineWithDaemon(sessionId, machineId);

    const result = await t.query(api.workspaces.getRecentCommits, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
    });

    expect(result).toBeNull();
  });

  test('getRecentCommits enforces access control', async () => {
    const { sessionId: sessionA } = await createTestSession('recent-commits-access-a');
    const machineId = 'recent-commits-access-machine';
    await registerMachineWithDaemon(sessionA, machineId);

    await t.mutation(api.workspaces.upsertRecentCommits, {
      sessionId: sessionA as any,
      machineId,
      workingDir: WORKING_DIR,
      commits: TEST_COMMITS,
      hasMoreCommits: false,
    });

    // Different session without access should get null
    const { sessionId: sessionB } = await createTestSession('recent-commits-access-b');
    const result = await t.query(api.workspaces.getRecentCommits, {
      sessionId: sessionB as any,
      machineId,
      workingDir: WORKING_DIR,
    });

    expect(result).toBeNull();
  });
});
