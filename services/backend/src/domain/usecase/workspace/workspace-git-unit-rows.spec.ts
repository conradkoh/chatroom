/**
 * Unit tests for workspace-git-unit-rows (kind→table read/delete helpers).
 *
 * Each test uses its own machineId/workingDir: the test DB is shared across
 * tests in this file.
 */

import { describe, expect, test } from 'vitest';

import {
  deleteWorkspaceGitUnitRows,
  findUnitRow,
  readWorkspaceGitUnitRows,
  type WorkspaceTarget,
} from './workspace-git-unit-rows';
import { t } from '../../../../test.setup';
import { WORKSPACE_GIT_UNIT_TABLE } from '../../entities/workspace-git-state-unit';

const NOW = 1_800_000_000_000;

/** Every per-unit table, derived from the kind→table SSOT. */
const UNIT_TABLES = Object.values(WORKSPACE_GIT_UNIT_TABLE);

type HeadStatus = 'available' | 'not_found' | 'error';

/** Inserts exactly one row per unit table for the target. */
async function seedAllUnitRows(target: WorkspaceTarget, headStatus: HeadStatus = 'available') {
  await t.run(async (ctx) => {
    const base = { machineId: target.machineId, workingDir: target.workingDir, updatedAt: NOW };
    const head =
      headStatus === 'available'
        ? { ...base, status: 'available' as const, branch: 'main' }
        : headStatus === 'error'
          ? { ...base, status: 'error' as const, errorMessage: 'boom' }
          : { ...base, status: 'not_found' as const };

    await ctx.db.insert('chatroom_workspaceGitHead', head);
    await ctx.db.insert('chatroom_workspaceGitWorktree', {
      ...base,
      isDirty: false,
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
    });
    await ctx.db.insert('chatroom_workspaceGitUpstream', {
      ...base,
      commitsAhead: 1,
      commitsBehind: 2,
    });
    await ctx.db.insert('chatroom_workspaceGitRemotes', {
      ...base,
      remotes: [{ name: 'origin', url: 'https://example.test/repo.git' }],
    });
    await ctx.db.insert('chatroom_workspaceGitPullRequests', {
      ...base,
      openPullRequests: [
        {
          prNumber: 1,
          title: 'PR',
          url: 'https://example.test/pr/1',
          headRefName: 'main',
          state: 'OPEN',
        },
      ],
    });
    await ctx.db.insert('chatroom_workspaceGitChecks', { ...base, headCommitStatus: null });
  });
}

/** Counts unit rows in every table, keyed by table name. */
async function countUnitRows() {
  return t.run(async (ctx) => {
    const counts: Record<string, { machineId: string; workingDir: string }[]> = {};
    for (const table of UNIT_TABLES) {
      counts[table] = await (ctx.db.query(table as any) as any).collect();
    }
    return counts;
  });
}

function targetAt(suffix: string): WorkspaceTarget {
  return { machineId: `git-unit-machine-${suffix}`, workingDir: `/tmp/git-unit-${suffix}` };
}

describe('findUnitRow', () => {
  test('returns the row for the matching (machineId, workingDir)', async () => {
    const target = targetAt('find-hit');
    await seedAllUnitRows(target);

    const head = await t.run((ctx) => findUnitRow(ctx, 'head', target));

    expect(head).toMatchObject({
      machineId: target.machineId,
      workingDir: target.workingDir,
      status: 'available',
      branch: 'main',
    });
  });

  test('returns null when no row matches the target or the kind', async () => {
    const target = targetAt('find-miss');
    await seedAllUnitRows(target);

    const wrongMachine = await t.run((ctx) =>
      findUnitRow(ctx, 'head', { machineId: 'other-machine', workingDir: target.workingDir })
    );
    const wrongDir = await t.run((ctx) =>
      findUnitRow(ctx, 'head', { machineId: target.machineId, workingDir: '/tmp/other' })
    );
    const noUpstream = await t.run((ctx) =>
      findUnitRow(ctx, 'upstream', targetAt('find-miss-empty'))
    );

    expect(wrongMachine).toBeNull();
    expect(wrongDir).toBeNull();
    expect(noUpstream).toBeNull();
  });
});

describe('readWorkspaceGitUnitRows', () => {
  test.each(['not_found', 'error'] as const)(
    'head %s short-circuits: other five are null even when their rows exist',
    async (status) => {
      const target = targetAt(`short-${status}`);
      await seedAllUnitRows(target, status);

      const rows = await t.run((ctx) => readWorkspaceGitUnitRows(ctx, target));

      expect(rows.head).toMatchObject({ status });
      expect(rows.worktree).toBeNull();
      expect(rows.upstream).toBeNull();
      expect(rows.remotes).toBeNull();
      expect(rows.pullRequests).toBeNull();
      expect(rows.checks).toBeNull();

      // Prove the short-circuit: the non-head rows really are present.
      const counts = await countUnitRows();
      expect(
        counts.chatroom_workspaceGitWorktree!.filter(
          (row) => row.machineId === target.machineId && row.workingDir === target.workingDir
        )
      ).toHaveLength(1);
    }
  );

  test('returns null head and null others when no head row exists', async () => {
    const target = targetAt('no-head');
    await seedAllUnitRows(target);
    await t.run(async (ctx) => {
      const heads = await ctx.db
        .query('chatroom_workspaceGitHead')
        .withIndex('by_machine_workingDir', (q) =>
          q.eq('machineId', target.machineId).eq('workingDir', target.workingDir)
        )
        .collect();
      for (const head of heads) await ctx.db.delete('chatroom_workspaceGitHead', head._id);
    });

    const rows = await t.run((ctx) => readWorkspaceGitUnitRows(ctx, target));

    expect(rows).toEqual({
      head: null,
      worktree: null,
      upstream: null,
      remotes: null,
      pullRequests: null,
      checks: null,
    });
  });

  test('returns all six rows when head is available', async () => {
    const target = targetAt('all-six');
    await seedAllUnitRows(target);

    const rows = await t.run((ctx) => readWorkspaceGitUnitRows(ctx, target));

    expect(rows.head).toMatchObject({ status: 'available', branch: 'main' });
    expect(rows.worktree).toMatchObject({ isDirty: false });
    expect(rows.upstream).toMatchObject({ commitsAhead: 1, commitsBehind: 2 });
    expect(rows.remotes).toMatchObject({
      remotes: [{ name: 'origin', url: 'https://example.test/repo.git' }],
    });
    expect(rows.pullRequests).toMatchObject({ openPullRequests: [{ prNumber: 1 }] });
    expect(rows.checks).toMatchObject({ headCommitStatus: null });
  });
});

describe('deleteWorkspaceGitUnitRows', () => {
  test('deletes only the (machineId, workingDir) rows across all six tables', async () => {
    const machine = targetAt('del-dir-a');
    const otherDir = { machineId: machine.machineId, workingDir: '/tmp/git-unit-del-dir-b' };
    const otherMachine = targetAt('del-other-machine');
    await seedAllUnitRows(machine);
    await seedAllUnitRows(otherDir);
    await seedAllUnitRows(otherMachine);

    await t.run((ctx) => deleteWorkspaceGitUnitRows(ctx, machine.machineId, machine.workingDir));

    const counts = await countUnitRows();
    for (const table of UNIT_TABLES) {
      const rows = counts[table]!;
      expect(
        rows.filter((r) => r.machineId === machine.machineId && r.workingDir === machine.workingDir)
      ).toHaveLength(0);
      expect(
        rows.filter(
          (r) => r.machineId === machine.machineId && r.workingDir === otherDir.workingDir
        )
      ).toHaveLength(1);
      expect(rows.filter((r) => r.machineId === otherMachine.machineId)).toHaveLength(1);
    }
  });

  test('deletes all rows for the machine and leaves other machines untouched', async () => {
    const machine = targetAt('del-machine');
    const secondDir = { machineId: machine.machineId, workingDir: '/tmp/git-unit-del-machine-2' };
    const otherMachine = targetAt('del-machine-other');
    await seedAllUnitRows(machine);
    await seedAllUnitRows(secondDir);
    await seedAllUnitRows(otherMachine);

    await t.run((ctx) => deleteWorkspaceGitUnitRows(ctx, machine.machineId));

    const counts = await countUnitRows();
    for (const table of UNIT_TABLES) {
      const rows = counts[table]!;
      expect(rows.filter((r) => r.machineId === machine.machineId)).toHaveLength(0);
      expect(rows.filter((r) => r.machineId === otherMachine.machineId)).toHaveLength(1);
    }
  });
});
