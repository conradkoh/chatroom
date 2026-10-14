/**
 * Workspace Removal Cleanup — Integration Tests
 *
 * Verifies that when a workspace is removed from a chatroom, related
 * `chatroom_agentLastSentLaunchRequests` entries are purged to prevent
 * "ghost machines", and that workspace removal / machine cleanup purge the
 * per-unit git state tables (`chatroom_workspaceGitHead` … `…GitChecks`).
 *
 * Cases:
 * 1. Removing the only workspace purges configs for that machine+chatroom
 * 2. Removing one workspace does NOT purge configs if the machine has another active workspace
 * 3. Removing a workspace does NOT affect configs for other machines
 * 4. Removing a workspace purges only its own unit rows and legacy blob row
 * 5. Machine cleanup purges all unit rows for that machine only
 */

import { describe, expect, test } from 'vitest';

import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { WORKSPACE_GIT_UNIT_TABLE } from '../../src/domain/entities/workspace-git-state-unit';
import { t } from '../../test.setup';
import {
  createTestSession,
  createDuoTeamChatroom,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../helpers/integration';

/** Every per-unit table, derived from the kind→table SSOT. */
const UNIT_TABLES = Object.values(WORKSPACE_GIT_UNIT_TABLE);

type UnitTable = (typeof UNIT_TABLES)[number];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Register a workspace in a chatroom for a machine.
 * Returns the workspaceId.
 */
async function registerWorkspace(
  sessionId: string,
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string,
  workingDir: string
): Promise<Id<'chatroom_workspaces'>> {
  return t.mutation(api.workspaces.registerWorkspace, {
    sessionId: sessionId as any,
    chatroomId,
    machineId,
    workingDir,
    hostname: 'test-host',
    registeredBy: 'builder',
  });
}

/**
 * Query all persisted launch snapshots for a chatroom.
 */
async function getLaunchRequests(chatroomId: Id<'chatroom_rooms'>) {
  return t.run(async (ctx) => {
    return ctx.db
      .query('chatroom_agentLastSentLaunchRequests')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
  });
}

/** Insert one row into each per-unit git state table for the target. */
async function seedUnitRows(machineId: string, workingDir: string) {
  await t.run(async (ctx) => {
    const base = { machineId, workingDir, updatedAt: Date.now() };
    await ctx.db.insert('chatroom_workspaceGitHead', {
      ...base,
      status: 'available',
      branch: 'main',
    });
    await ctx.db.insert('chatroom_workspaceGitWorktree', {
      ...base,
      isDirty: false,
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
    });
    await ctx.db.insert('chatroom_workspaceGitUpstream', {
      ...base,
      commitsAhead: 1,
      commitsBehind: 0,
    });
    await ctx.db.insert('chatroom_workspaceGitRemotes', {
      ...base,
      remotes: [{ name: 'origin', url: 'https://example.test/repo.git' }],
    });
    await ctx.db.insert('chatroom_workspaceGitPullRequests', {
      ...base,
      openPullRequests: [],
    });
    await ctx.db.insert('chatroom_workspaceGitChecks', { ...base, headCommitStatus: null });
  });
}

/** Insert one legacy git-state blob row for the target. */
async function seedBlobRow(machineId: string, workingDir: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert('chatroom_workspaceGitState', {
      machineId,
      workingDir,
      status: 'available',
      branch: 'main',
      updatedAt: Date.now(),
    });
  });
}

/** Unit rows filtered by machine and, optionally, workingDir. */
async function unitRows(table: UnitTable, machineId: string, workingDir?: string) {
  return t.run(async (ctx) => {
    const rows: { machineId: string; workingDir: string }[] = await (
      ctx.db.query(table as any) as any
    ).collect();
    return rows.filter(
      (row) =>
        row.machineId === machineId && (workingDir === undefined || row.workingDir === workingDir)
    );
  });
}

/** Legacy blob rows filtered by machine and, optionally, workingDir. */
async function blobRows(machineId: string, workingDir?: string) {
  return t.run(async (ctx) => {
    const rows = await ctx.db
      .query('chatroom_workspaceGitState')
      .withIndex('by_machine_workingDir', (q) => q.eq('machineId', machineId))
      .collect();
    return rows.filter((row) => workingDir === undefined || row.workingDir === workingDir);
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('workspace removal cleanup', () => {
  test('removing the only workspace purges launch snapshots for that machine+chatroom', async () => {
    const sessionId = 'test-wrc-1';
    const { sessionId: sid } = await createTestSession(sessionId);
    const chatroomId = await createDuoTeamChatroom(sid);
    const machineId = 'machine-wrc-1';
    await registerMachineWithDaemon(sid, machineId);

    // Register a workspace
    const workspaceId = await registerWorkspace(sid, chatroomId, machineId, '/test/workspace');

    // Create a teamAgentConfig for this machine+chatroom
    await setupRemoteAgentConfig(sid, chatroomId, machineId, 'builder');

    // Verify config exists before removal
    const requestsBefore = await getLaunchRequests(chatroomId);
    expect(requestsBefore.filter((c) => c.machineId === machineId).length).toBeGreaterThan(0);

    // Remove the workspace
    await t.mutation(api.workspaces.removeWorkspace, {
      sessionId: sid,
      workspaceId,
    });

    // Config should be purged
    const requestsAfter = await getLaunchRequests(chatroomId);
    expect(requestsAfter.filter((c) => c.machineId === machineId).length).toBe(0);
  });

  test('removing one workspace does NOT purge configs when the machine has another active workspace', async () => {
    const sessionId = 'test-wrc-2';
    const { sessionId: sid } = await createTestSession(sessionId);
    const chatroomId = await createDuoTeamChatroom(sid);
    const machineId = 'machine-wrc-2';
    await registerMachineWithDaemon(sid, machineId);

    // Register TWO workspaces for the same machine in the same chatroom
    const workspaceId1 = await registerWorkspace(sid, chatroomId, machineId, '/test/workspace-a');
    await registerWorkspace(sid, chatroomId, machineId, '/test/workspace-b');

    // Create a teamAgentConfig for this machine+chatroom
    await setupRemoteAgentConfig(sid, chatroomId, machineId, 'builder');

    // Verify config exists before removal
    const requestsBefore = await getLaunchRequests(chatroomId);
    expect(requestsBefore.filter((c) => c.machineId === machineId).length).toBeGreaterThan(0);

    // Remove only ONE workspace — the other remains active
    await t.mutation(api.workspaces.removeWorkspace, {
      sessionId: sid,
      workspaceId: workspaceId1,
    });

    // Config should still exist (other workspace is active)
    const requestsAfter = await getLaunchRequests(chatroomId);
    expect(requestsAfter.filter((c) => c.machineId === machineId).length).toBeGreaterThan(0);
  });

  test('removing a workspace does NOT affect configs for other machines in the same chatroom', async () => {
    const sessionId = 'test-wrc-3';
    const { sessionId: sid } = await createTestSession(sessionId);
    const chatroomId = await createDuoTeamChatroom(sid);

    const machineIdA = 'machine-wrc-3a';
    const machineIdB = 'machine-wrc-3b';
    await registerMachineWithDaemon(sid, machineIdA);
    await registerMachineWithDaemon(sid, machineIdB);

    // Register a workspace for each machine
    const workspaceIdA = await registerWorkspace(sid, chatroomId, machineIdA, '/workspace-a');
    await registerWorkspace(sid, chatroomId, machineIdB, '/workspace-b');

    // Create configs for both machines
    await setupRemoteAgentConfig(sid, chatroomId, machineIdA, 'builder', {
      workingDir: '/workspace-a',
    });
    await setupRemoteAgentConfig(sid, chatroomId, machineIdB, 'planner', {
      workingDir: '/workspace-b',
    });

    // Verify configs for both machines exist
    const requestsBefore = await getLaunchRequests(chatroomId);
    expect(requestsBefore.filter((c) => c.machineId === machineIdA).length).toBeGreaterThan(0);
    expect(requestsBefore.filter((c) => c.machineId === machineIdB).length).toBeGreaterThan(0);

    // Remove machine A's workspace
    await t.mutation(api.workspaces.removeWorkspace, {
      sessionId: sid,
      workspaceId: workspaceIdA,
    });

    // Machine A's config should be purged, machine B's config should be untouched
    const requestsAfter = await getLaunchRequests(chatroomId);
    expect(requestsAfter.filter((c) => c.machineId === machineIdA).length).toBe(0);
    expect(requestsAfter.filter((c) => c.machineId === machineIdB).length).toBeGreaterThan(0);
  });
});

describe('workspace git unit row purge', () => {
  test('removing a workspace purges its unit rows and blob row only', async () => {
    const { sessionId: sid } = await createTestSession('test-git-unit-remove');
    const chatroomId = await createDuoTeamChatroom(sid);
    const machineId = 'machine-git-unit-remove';
    const otherMachineId = 'machine-git-unit-remove-other';
    const dirA = '/test/git-unit-a';
    const dirB = '/test/git-unit-b';
    await registerMachineWithDaemon(sid, machineId);
    await registerMachineWithDaemon(sid, otherMachineId);

    const workspaceId = await registerWorkspace(sid, chatroomId, machineId, dirA);

    // Two workingDirs on the target machine plus a row on a second machine.
    for (const [machine, dir] of [
      [machineId, dirA],
      [machineId, dirB],
      [otherMachineId, dirA],
    ] as const) {
      await seedUnitRows(machine, dir);
      await seedBlobRow(machine, dir);
    }

    await t.mutation(api.workspaces.removeWorkspace, { sessionId: sid, workspaceId });

    for (const table of UNIT_TABLES) {
      expect(await unitRows(table, machineId, dirA)).toHaveLength(0);
      expect(await unitRows(table, machineId, dirB)).toHaveLength(1);
      expect(await unitRows(table, otherMachineId, dirA)).toHaveLength(1);
    }
    expect(await blobRows(machineId, dirA)).toHaveLength(0);
    expect(await blobRows(machineId, dirB)).toHaveLength(1);
    expect(await blobRows(otherMachineId, dirA)).toHaveLength(1);
  });

  test('machine cleanup purges all unit rows for that machine only', async () => {
    const { sessionId: sid } = await createTestSession('test-git-unit-cleanup');
    const chatroomId = await createDuoTeamChatroom(sid);
    const machineId = 'machine-git-unit-cleanup';
    const otherMachineId = 'machine-git-unit-cleanup-other';
    await registerMachineWithDaemon(sid, machineId);
    await registerMachineWithDaemon(sid, otherMachineId);
    await registerWorkspace(sid, chatroomId, machineId, '/test/git-unit-cleanup-a');

    // Two workingDirs on the machine being cleaned up, one on the survivor.
    for (const [machine, dir] of [
      [machineId, '/test/git-unit-cleanup-a'],
      [machineId, '/test/git-unit-cleanup-b'],
      [otherMachineId, '/test/git-unit-cleanup-a'],
    ] as const) {
      await seedUnitRows(machine, dir);
      await seedBlobRow(machine, dir);
    }

    // Machine cleanup selection is driven by machine capabilities recency.
    await t.run(async (ctx) => {
      const capabilities = await ctx.db
        .query('chatroom_machineCapabilities')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      expect(capabilities).toBeDefined();
      await ctx.db.patch(capabilities!._id, { lastSeenAt: Date.now() - 91 * 24 * 60 * 60 * 1000 });
    });

    await t.mutation(internal.chatroomCleanup.cleanupMachines, {});

    for (const table of UNIT_TABLES) {
      expect(await unitRows(table, machineId)).toHaveLength(0);
      expect(await unitRows(table, otherMachineId)).toHaveLength(1);
    }
    expect(await blobRows(machineId)).toHaveLength(0);
    expect(await blobRows(otherMachineId)).toHaveLength(1);
  });
});
