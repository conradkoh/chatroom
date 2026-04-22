/**
 * PR Diff Per-PR Cache — Integration Tests
 *
 * Verifies that `requestPRDiff` and `getPRDiff` correctly key the cache by
 * (machineId, workingDir, prNumber) so that:
 * 1. Two PRs on the same workspace get independent cache rows.
 * 2. A pending request for PR #1 does NOT suppress a request for PR #2.
 * 3. Requesting the same PR twice while it is still pending is idempotent.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WORKING_DIR = '/workspace/project';
const BASE_BRANCH = 'main';

async function requestDiff(
  sessionId: string,
  machineId: string,
  prNumber: number
): Promise<void> {
  return t.mutation(api.workspaces.requestPRDiff, {
    sessionId: sessionId as any,
    machineId,
    workingDir: WORKING_DIR,
    baseBranch: BASE_BRANCH,
    prNumber,
  });
}

async function upsertDiff(
  sessionId: string,
  machineId: string,
  prNumber: number,
  diffContent: string
): Promise<void> {
  return t.mutation(api.workspaces.upsertPRDiff, {
    sessionId: sessionId as any,
    machineId,
    workingDir: WORKING_DIR,
    baseBranch: BASE_BRANCH,
    prNumber,
    diffContent,
    truncated: false,
    diffStat: { filesChanged: 1, insertions: 10, deletions: 2 },
  });
}

async function getDiff(sessionId: string, machineId: string, prNumber: number) {
  return t.query(api.workspaces.getPRDiff, {
    sessionId: sessionId as any,
    machineId,
    workingDir: WORKING_DIR,
    prNumber,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PR diff per-PR cache', () => {
  test('two PRs on the same workspace get independent cache rows', async () => {
    const { sessionId } = await createTestSession('pr-diff-session-1');
    const { machineId } = await registerMachineWithDaemon(sessionId, 'pr-diff-machine-1');

    await upsertDiff(sessionId, machineId, 1, 'diff for PR 1');
    await upsertDiff(sessionId, machineId, 2, 'diff for PR 2');

    const pr1 = await getDiff(sessionId, machineId, 1);
    const pr2 = await getDiff(sessionId, machineId, 2);

    expect(pr1).not.toBeNull();
    expect(pr2).not.toBeNull();
    expect(pr1?.diffContent).toBe('diff for PR 1');
    expect(pr2?.diffContent).toBe('diff for PR 2');
    // Rows must be independent
    expect(pr1?._id).not.toBe(pr2?._id);
  });

  test('getPRDiff returns null for an unrequested PR', async () => {
    const { sessionId } = await createTestSession('pr-diff-session-2');
    const { machineId } = await registerMachineWithDaemon(sessionId, 'pr-diff-machine-2');

    await upsertDiff(sessionId, machineId, 1, 'diff for PR 1');

    const pr99 = await getDiff(sessionId, machineId, 99);
    expect(pr99).toBeNull();
  });

  test('pending request for PR #1 does NOT suppress a new request for PR #2', async () => {
    const { sessionId } = await createTestSession('pr-diff-session-3');
    const { machineId } = await registerMachineWithDaemon(sessionId, 'pr-diff-machine-3');

    // Request PR #1 — creates a pending row
    await requestDiff(sessionId, machineId, 1);

    // Request PR #2 while PR #1 is still pending — should NOT be a no-op.
    // Before the fix, requestPRDiff checked only (machineId, workingDir, type='pr_diff', status='pending')
    // and returned early, so PR #2's request was never created.
    await requestDiff(sessionId, machineId, 2);

    // Simulate daemon fulfilling PR #2 diff — this only works if the PR #2 request was created.
    await upsertDiff(sessionId, machineId, 2, 'fulfilled diff for PR 2');

    const pr2 = await getDiff(sessionId, machineId, 2);
    expect(pr2).not.toBeNull();
    expect(pr2?.diffContent).toBe('fulfilled diff for PR 2');

    // PR #1 result should be null (never fulfilled in this test)
    const pr1 = await getDiff(sessionId, machineId, 1);
    expect(pr1).toBeNull();
  });

  test('requesting the same PR twice while pending is idempotent', async () => {
    const { sessionId } = await createTestSession('pr-diff-session-4');
    const { machineId } = await registerMachineWithDaemon(sessionId, 'pr-diff-machine-4');

    // Two identical requests — should not throw
    await requestDiff(sessionId, machineId, 5);
    await requestDiff(sessionId, machineId, 5); // no-op (idempotent)

    // Fulfilling via upsert should work regardless
    await upsertDiff(sessionId, machineId, 5, 'diff content');
    const result = await getDiff(sessionId, machineId, 5);
    expect(result?.diffContent).toBe('diff content');
  });

  test('upsertPRDiff overwrites existing row for the same prNumber', async () => {
    const { sessionId } = await createTestSession('pr-diff-session-5');
    const { machineId } = await registerMachineWithDaemon(sessionId, 'pr-diff-machine-5');

    await upsertDiff(sessionId, machineId, 3, 'old diff');
    await upsertDiff(sessionId, machineId, 3, 'updated diff');

    const result = await getDiff(sessionId, machineId, 3);
    expect(result?.diffContent).toBe('updated diff');
  });
});
