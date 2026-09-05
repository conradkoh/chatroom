/**
 * getPendingRequestsForWorkspace / getPendingRequests — daemon git request feed.
 *
 * Covers workspace isolation, non-pending exclusion, cross-machine isolation
 * on a shared workingDir, unauthorized/missing-session `[]`, and that the
 * machine-wide query remains intact for the imperative recovery drain.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';

const now = Date.now();

async function insertRequest(rows: {
  machineId: string;
  workingDir: string;
  requestType?: string | undefined;
  status: string;
  requestedAt?: number | undefined;
  updatedAt?: number | undefined;
}): Promise<void> {
  await t.run((ctx) =>
    ctx.db.insert('chatroom_workspaceDiffRequests', {
      machineId: rows.machineId,
      workingDir: rows.workingDir,
      requestType: rows.requestType ?? 'full_diff',
      status: rows.status,
      requestedAt: rows.requestedAt ?? now,
      updatedAt: rows.updatedAt ?? now,
    })
  );
}

describe('daemon pending git diff/commit requests', () => {
  test('getPendingRequestsForWorkspace returns only pending rows for the requested workspace', async () => {
    const { sessionId } = await createTestSession('git-ws-isolation');
    const machineId = 'git-ws-isolation-machine';
    await registerMachineWithDaemon(sessionId, machineId);

    await insertRequest({ machineId, workingDir: '/ws-a', status: 'pending' });
    await insertRequest({ machineId, workingDir: '/ws-a', status: 'done' });
    await insertRequest({ machineId, workingDir: '/ws-b', status: 'pending' });

    const pending = await t.query(api.workspaces.getPendingRequestsForWorkspace, {
      sessionId: sessionId as any,
      machineId,
      workingDir: '/ws-a',
    });

    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ machineId, workingDir: '/ws-a', status: 'pending' });
  });

  test('getPendingRequestsForWorkspace isolates machines sharing the same workingDir', async () => {
    const { sessionId: sessionX } = await createTestSession('git-ws-cross-x');
    const machineX = 'git-ws-cross-x-machine';
    await registerMachineWithDaemon(sessionX, machineX);

    const { sessionId: sessionY } = await createTestSession('git-ws-cross-y');
    const machineY = 'git-ws-cross-y-machine';
    await registerMachineWithDaemon(sessionY, machineY);

    await insertRequest({ machineId: machineX, workingDir: '/shared', status: 'pending' });

    const pendingY = await t.query(api.workspaces.getPendingRequestsForWorkspace, {
      sessionId: sessionY as any,
      machineId: machineY,
      workingDir: '/shared',
    });

    expect(pendingY).toEqual([]);
  });

  test('getPendingRequestsForWorkspace returns [] for a mismatched/unauthorized session', async () => {
    const { sessionId } = await createTestSession('git-ws-unauth-owner');
    const machineId = 'git-ws-unauth-machine';
    await registerMachineWithDaemon(sessionId, machineId);

    const { sessionId: otherSession } = await createTestSession('git-ws-unauth-other');

    const unauthorized = await t.query(api.workspaces.getPendingRequestsForWorkspace, {
      sessionId: otherSession as any,
      machineId,
      workingDir: '/ws-a',
    });
    expect(unauthorized).toEqual([]);

    const missingSession = await t.query(api.workspaces.getPendingRequestsForWorkspace, {
      sessionId: 'never-registered-session' as any,
      machineId,
      workingDir: '/ws-a',
    });
    expect(missingSession).toEqual([]);
  });

  test('getPendingRequests (machine-wide) remains intact for imperative recovery', async () => {
    const { sessionId } = await createTestSession('git-wide-intact');
    const machineId = 'git-wide-intact-machine';
    await registerMachineWithDaemon(sessionId, machineId);

    await insertRequest({ machineId, workingDir: '/ws-a', status: 'pending' });
    await insertRequest({ machineId, workingDir: '/ws-b', status: 'pending' });

    const pending = await t.query(api.workspaces.getPendingRequests, {
      sessionId: sessionId as any,
      machineId,
    });

    expect(pending).toHaveLength(2);
    expect(pending.map((row: { workingDir: string }) => row.workingDir).sort()).toEqual([
      '/ws-a',
      '/ws-b',
    ]);
  });
});
