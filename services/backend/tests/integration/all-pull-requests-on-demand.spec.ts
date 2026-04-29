/**
 * requestAllPullRequests / upsertAllPullRequests / getAllPullRequests — integration tests.
 *
 * Covers idempotency, storage shape, and query behavior for on-demand
 * all-pull-requests fetching.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';

const WORKING_DIR = '/tmp/all-pull-requests-spec';

const TEST_PRS = [
  {
    prNumber: 1,
    title: 'feat: add auth',
    url: 'https://github.com/test/repo/pull/1',
    headRefName: 'feat/auth',
    baseRefName: 'main',
    state: 'OPEN',
    author: 'alice',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    mergedAt: null,
    closedAt: null,
    isDraft: false,
  },
  {
    prNumber: 2,
    title: 'fix: typo',
    url: 'https://github.com/test/repo/pull/2',
    headRefName: 'fix/typo',
    baseRefName: 'main',
    state: 'CLOSED',
    author: 'bob',
    createdAt: '2024-01-03T00:00:00Z',
    updatedAt: '2024-01-04T00:00:00Z',
    mergedAt: null,
    closedAt: '2024-01-04T00:00:00Z',
    isDraft: false,
  },
];

describe('allPullRequests on-demand APIs', () => {
  test('requestAllPullRequests creates a pending diff request', async () => {
    const { sessionId } = await createTestSession('all-prs-request');
    const machineId = 'all-prs-request-machine';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.mutation(api.workspaces.requestAllPullRequests, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
    });

    const requests = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_workspaceDiffRequests')
        .withIndex('by_machine_workingDir_type', (q) =>
          q
            .eq('machineId', machineId)
            .eq('workingDir', WORKING_DIR)
            .eq('requestType', 'all_pull_requests')
        )
        .collect();
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]!.status).toBe('pending');
    expect(requests[0]!.requestType).toBe('all_pull_requests');
  });

  test('requestAllPullRequests is idempotent — does not duplicate pending requests', async () => {
    const { sessionId } = await createTestSession('all-prs-idempotent');
    const machineId = 'all-prs-idempotent-machine';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.mutation(api.workspaces.requestAllPullRequests, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
    });

    await t.mutation(api.workspaces.requestAllPullRequests, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
    });

    const requests = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_workspaceDiffRequests')
        .withIndex('by_machine_workingDir_type', (q) =>
          q
            .eq('machineId', machineId)
            .eq('workingDir', WORKING_DIR)
            .eq('requestType', 'all_pull_requests')
        )
        .collect();
    });

    expect(requests).toHaveLength(1);
  });

  test('upsertAllPullRequests stores pull requests and getAllPullRequests retrieves them', async () => {
    const { sessionId } = await createTestSession('all-prs-upsert');
    const machineId = 'all-prs-upsert-machine';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.mutation(api.workspaces.upsertAllPullRequests, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
      pullRequests: TEST_PRS,
    });

    const result = await t.query(api.workspaces.getAllPullRequests, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
    });

    expect(result).not.toBeNull();
    expect(result!.pullRequests).toHaveLength(2);
    expect(result!.pullRequests[0]!.prNumber).toBe(1);
    expect(result!.pullRequests[0]!.title).toBe('feat: add auth');
    expect(result!.pullRequests[1]!.prNumber).toBe(2);
    expect(result!.pullRequests[1]!.state).toBe('CLOSED');
  });

  test('upsertAllPullRequests patches existing row on second call', async () => {
    const { sessionId } = await createTestSession('all-prs-patch');
    const machineId = 'all-prs-patch-machine';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.mutation(api.workspaces.upsertAllPullRequests, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
      pullRequests: TEST_PRS,
    });

    const updatedPRs = [
      {
        ...TEST_PRS[0]!,
        state: 'MERGED',
        mergedAt: '2024-01-05T00:00:00Z',
      },
    ];

    await t.mutation(api.workspaces.upsertAllPullRequests, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
      pullRequests: updatedPRs,
    });

    const result = await t.query(api.workspaces.getAllPullRequests, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
    });

    expect(result).not.toBeNull();
    expect(result!.pullRequests).toHaveLength(1);
    expect(result!.pullRequests[0]!.state).toBe('MERGED');
    expect(result!.pullRequests[0]!.mergedAt).toBe('2024-01-05T00:00:00Z');
  });

  test('getAllPullRequests returns null when no data exists', async () => {
    const { sessionId } = await createTestSession('all-prs-empty');
    const machineId = 'all-prs-empty-machine';
    await registerMachineWithDaemon(sessionId, machineId);

    const result = await t.query(api.workspaces.getAllPullRequests, {
      sessionId: sessionId as any,
      machineId,
      workingDir: WORKING_DIR,
    });

    expect(result).toBeNull();
  });

  test('getAllPullRequests enforces access control', async () => {
    const { sessionId: sessionA } = await createTestSession('all-prs-access-a');
    const machineId = 'all-prs-access-machine';
    await registerMachineWithDaemon(sessionA, machineId);

    await t.mutation(api.workspaces.upsertAllPullRequests, {
      sessionId: sessionA as any,
      machineId,
      workingDir: WORKING_DIR,
      pullRequests: TEST_PRS,
    });

    // Different session without access should get null
    const { sessionId: sessionB } = await createTestSession('all-prs-access-b');
    const result = await t.query(api.workspaces.getAllPullRequests, {
      sessionId: sessionB as any,
      machineId,
      workingDir: WORKING_DIR,
    });

    expect(result).toBeNull();
  });
});
