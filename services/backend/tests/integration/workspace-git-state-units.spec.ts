/**
 * Workspace git state from per-unit tables — end-to-end through the Convex API.
 *
 * `patchWorkspaceGitState` writes one unit row per call; `getWorkspaceGitState` assembles the view
 * from those rows. The legacy `chatroom_workspaceGitState` blob is not read by either path.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { WorkspaceGitStateUnit } from '../../src/domain/entities/workspace-git-state-unit';
import { findUnitRow } from '../../src/domain/usecase/workspace/workspace-git-unit-rows';
import { t } from '../../test.setup';
import {
  createTestSession,
  createDuoTeamChatroom,
  registerMachineWithDaemon,
} from '../helpers/integration';

async function setup(suffix: string) {
  const { sessionId: sid } = await createTestSession(`git-units-${suffix}`);
  const chatroomId = await createDuoTeamChatroom(sid);
  const machineId = `machine-git-units-${suffix}`;
  const workingDir = `/tmp/git-units-${suffix}`;
  await registerMachineWithDaemon(sid, machineId);
  const workspaceId = await t.mutation(api.workspaces.registerWorkspace, {
    sessionId: sid,
    chatroomId,
    machineId,
    workingDir,
    hostname: 'test-host',
    registeredBy: 'test',
  });
  return { sid, chatroomId, machineId, workingDir, workspaceId };
}

function patch(
  sessionId: SessionId,
  machineId: string,
  workingDir: string,
  unit: WorkspaceGitStateUnit
): Promise<{ applied: true } | { applied: false; reason: 'unchanged' | 'workspace_inactive' }> {
  return t.mutation(api.workspaces.patchWorkspaceGitState, {
    sessionId,
    machineId,
    workingDir,
    unit,
  });
}

function getState(sessionId: SessionId, machineId: string, workingDir: string) {
  return t.query(api.workspaces.getWorkspaceGitState, {
    sessionId,
    machineId,
    workingDir,
  });
}

type UnitKind = WorkspaceGitStateUnit['kind'];

const UNITS: Record<UnitKind, WorkspaceGitStateUnit> = {
  head: { kind: 'head', status: 'available', branch: 'main' },
  worktree: {
    kind: 'worktree',
    isDirty: true,
    diffStat: { filesChanged: 2, insertions: 5, deletions: 1 },
  },
  upstream: { kind: 'upstream', commitsAhead: 3, commitsBehind: 1 },
  remotes: { kind: 'remotes', remotes: [{ name: 'origin', url: 'git@example.com:app.git' }] },
  pullRequests: {
    kind: 'pullRequests',
    openPullRequests: [
      {
        prNumber: 7,
        title: 'Add thing',
        url: 'https://example.test/pulls/7',
        headRefName: 'main',
        state: 'OPEN',
      },
    ],
  },
  checks: {
    kind: 'checks',
    headCommitStatus: {
      state: 'success',
      checkRuns: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
      totalCount: 1,
    },
  },
};

describe('workspace git state from per-unit tables', () => {
  test('assembles the available view from all six unit rows', async () => {
    const { sid, machineId, workingDir } = await setup('all');
    for (const unit of Object.values(UNITS)) {
      await patch(sid, machineId, workingDir, unit);
    }

    const view = await getState(sid, machineId, workingDir);

    expect(view).toMatchObject({
      status: 'available',
      branch: 'main',
      isDirty: true,
      diffStat: { filesChanged: 2, insertions: 5, deletions: 1 },
      openPullRequests: [
        {
          prNumber: 7,
          title: 'Add thing',
          url: 'https://example.test/pulls/7',
          headRefName: 'main',
          state: 'OPEN',
        },
      ],
      remotes: [{ name: 'origin', url: 'git@example.com:app.git' }],
      commitsAhead: 3,
      commitsBehind: 1,
      headCommitStatus: {
        state: 'success',
        checkRuns: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
        totalCount: 1,
      },
    });
    expect(view.status === 'available' && typeof view.updatedAt).toBe('number');
  });

  test('only head patched returns available with the documented defaults', async () => {
    const { sid, machineId, workingDir } = await setup('head-only');
    await patch(sid, machineId, workingDir, UNITS.head);

    const view = await getState(sid, machineId, workingDir);

    expect(view).toEqual({
      status: 'available',
      branch: 'main',
      isDirty: false,
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
      openPullRequests: [],
      remotes: [],
      commitsAhead: 0,
      commitsBehind: 0,
      headCommitStatus: null,
      updatedAt: expect.any(Number),
    });
  });

  test('no head row returns loading', async () => {
    const { sid, machineId, workingDir } = await setup('no-head');

    expect(await getState(sid, machineId, workingDir)).toEqual({ status: 'loading' });
  });

  test('a non-head row without head stays loading', async () => {
    const { sid, machineId, workingDir } = await setup('non-head');
    await patch(sid, machineId, workingDir, UNITS.worktree);

    expect(await getState(sid, machineId, workingDir)).toEqual({ status: 'loading' });
  });

  test('head not_found ignores the other unit rows', async () => {
    const { sid, machineId, workingDir } = await setup('not-found');
    await patch(sid, machineId, workingDir, UNITS.worktree);
    await patch(sid, machineId, workingDir, { kind: 'head', status: 'not_found' });

    const view = await getState(sid, machineId, workingDir);

    expect(view).toEqual({ status: 'not_found', updatedAt: expect.any(Number) });
    expect(Object.keys(view).sort()).toEqual(['status', 'updatedAt']);
  });

  test('an unchanged second patch returns unchanged', async () => {
    const { sid, machineId, workingDir } = await setup('unchanged');
    await patch(sid, machineId, workingDir, UNITS.head);

    const result = await patch(sid, machineId, workingDir, UNITS.head);

    expect(result).toEqual({ applied: false, reason: 'unchanged' });
  });

  test('a non-owner without access gets loading', async () => {
    const { sid, machineId, workingDir } = await setup('no-access');
    await patch(sid, machineId, workingDir, UNITS.head);

    const { sessionId: otherSession } = await createTestSession('git-units-no-access-other');

    expect(await getState(otherSession, machineId, workingDir)).toEqual({ status: 'loading' });
  });

  test('a patch after removing the workspace returns workspace_inactive and writes no row', async () => {
    const { sid, machineId, workingDir, workspaceId } = await setup('removed');
    await patch(sid, machineId, workingDir, UNITS.head);
    await t.mutation(api.workspaces.removeWorkspace, { sessionId: sid, workspaceId });

    const result = await patch(sid, machineId, workingDir, UNITS.head);

    expect(result).toEqual({ applied: false, reason: 'workspace_inactive' });
    const head = await t.run((ctx) => findUnitRow(ctx, 'head', { machineId, workingDir }));
    expect(head).toBeNull();
  });

  test('a legacy blob row for the same directory does not affect the view', async () => {
    const { sid, machineId, workingDir } = await setup('legacy-blob');
    await t.run((ctx) =>
      ctx.db.insert('chatroom_workspaceGitState', {
        machineId,
        workingDir,
        status: 'available',
        branch: 'legacy-blob',
        isDirty: true,
        diffStat: { filesChanged: 9, insertions: 9, deletions: 9 },
        updatedAt: Date.now(),
      })
    );

    expect(await getState(sid, machineId, workingDir)).toEqual({ status: 'loading' });
  });
});
