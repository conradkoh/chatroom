/**
 * workspaces.switchWorkspace — contract tests.
 *
 * Driven through the public `api.workspaces.switchWorkspace` and
 * `api.workspaces.registerWorkspace` mutations and `api.agents.listLastSentLaunchRequests`.
 * `t.run` is used only to read tables and to seed rows the public API refuses
 * (a second active workspace, custom-agent / legacy launch rows, status rows).
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { registerWorkspace as registerWorkspaceUseCase } from '../src/domain/usecase/workspace/register-workspace';
import { createDuoTeamChatroom, createTestSession } from '../tests/helpers/integration';
import {
  getGitRefreshCommandsForMachine,
  getInboxCommandsForChatroom,
  getInboxCommandsForMachine,
} from '../tests/helpers/machine-command-inbox';

// ─── Helpers ─────────────────────────────────────────────────────────────────

type ChatroomId = Id<'chatroom_rooms'>;
type WorkspaceId = Id<'chatroom_workspaces'>;

async function setupChatroom(sessionKey: string): Promise<{
  sessionId: SessionId;
  chatroomId: ChatroomId;
}> {
  const { sessionId } = await createTestSession(sessionKey);
  const chatroomId = await createDuoTeamChatroom(sessionId);
  return { sessionId, chatroomId };
}

async function registerMachine(
  sessionId: SessionId,
  machineId: string,
  harnesses: ('opencode-sdk' | 'codex-sdk')[] = ['opencode-sdk']
): Promise<void> {
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test-host',
    os: 'darwin',
    availableHarnesses: harnesses,
  });
  await t.mutation(api.machines.markDaemonOnline, { sessionId, machineId });
}

/** First workspace through the public mutation (the cap allows one). */
async function bindWorkspace(
  sessionId: SessionId,
  chatroomId: ChatroomId,
  machineId: string,
  workingDir: string
): Promise<WorkspaceId> {
  return t.mutation(api.workspaces.registerWorkspace, {
    sessionId,
    chatroomId,
    machineId,
    workingDir,
    hostname: 'test-host',
    registeredBy: 'user',
  });
}

/** Additional ACTIVE workspace: the cap refuses it at the mutation, so seed through the use case. */
async function seedWorkspace(
  chatroomId: ChatroomId,
  machineId: string,
  workingDir: string
): Promise<WorkspaceId> {
  return t.run((ctx) =>
    registerWorkspaceUseCase(ctx, {
      chatroomId,
      machineId,
      workingDir,
      hostname: 'test-host',
      registeredBy: 'test',
    })
  );
}

async function saveConfig(
  sessionId: SessionId,
  chatroomId: ChatroomId,
  workspaceId: WorkspaceId,
  machineId: string,
  role: string,
  options: {
    harness?: 'opencode-sdk' | 'codex-sdk';
    model?: string;
    workingDir: string;
  }
): Promise<void> {
  await t.mutation(api.agents.saveConfig, {
    sessionId,
    chatroomId,
    workspaceId,
    role,
    machineId,
    agentHarness: options.harness ?? 'opencode-sdk',
    model: options.model ?? 'test-model',
    workingDir: options.workingDir,
  });
}

async function switchWorkspace(
  sessionId: SessionId,
  args: {
    chatroomId: ChatroomId;
    machineId: string;
    workingDir: string;
    expectedWorkspaceId?: WorkspaceId | null;
  }
) {
  return t.mutation(api.workspaces.switchWorkspace, {
    sessionId,
    chatroomId: args.chatroomId,
    machineId: args.machineId,
    workingDir: args.workingDir,
    ...(args.expectedWorkspaceId === undefined
      ? {}
      : { expectedWorkspaceId: args.expectedWorkspaceId }),
  });
}

async function activeWorkspaces(chatroomId: ChatroomId) {
  return t.run(async (ctx) => {
    const rows = await ctx.db
      .query('chatroom_workspaces')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
    return rows.filter((row) => row.removedAt === undefined);
  });
}

async function allWorkspaces(chatroomId: ChatroomId) {
  return t.run(async (ctx) =>
    ctx.db
      .query('chatroom_workspaces')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect()
  );
}

async function primaryWorkspaceId(chatroomId: ChatroomId): Promise<WorkspaceId | null> {
  return t.run(async (ctx) => {
    const row = await ctx.db
      .query('chatroom_primaryWorkspaces')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .first();
    return row?.workspaceId ?? null;
  });
}

async function launchConfigsForWorkspace(workspaceId: WorkspaceId) {
  return t.run(async (ctx) => {
    const rows = await ctx.db.query('chatroom_agentLastSentLaunchRequests').collect();
    return rows.filter((row) => row.workspaceId === workspaceId);
  });
}

async function allLaunchConfigs() {
  return t.run((ctx) => ctx.db.query('chatroom_agentLastSentLaunchRequests').collect());
}

async function workspaceRow(workspaceId: WorkspaceId) {
  return t.run((ctx) => ctx.db.get('chatroom_workspaces', workspaceId));
}

/** Snapshot of every table a failed switch must leave untouched. */
async function snapshotTables(): Promise<string> {
  return t.run(async (ctx) => {
    const workspaces = await ctx.db.query('chatroom_workspaces').collect();
    const primaries = await ctx.db.query('chatroom_primaryWorkspaces').collect();
    const configs = await ctx.db.query('chatroom_agentLastSentLaunchRequests').collect();
    const inbox = await ctx.db.query('chatroom_machineCommandInbox').collect();
    const statuses = await ctx.db.query('chatroom_agentRoleStatusReadModel').collect();
    return JSON.stringify({ workspaces, primaries, configs, inbox, statuses });
  });
}

interface ConvexErrorData {
  code?: string;
  message?: string;
}

/** Assert the mutation rejects with `code` and return its payload. */
async function expectCode(promise: Promise<unknown>, code: string): Promise<ConvexErrorData> {
  try {
    await promise;
  } catch (error) {
    const data = (error as { data?: ConvexErrorData }).data;
    expect(data?.code).toBe(code);
    return data ?? {};
  }
  throw new Error(`Expected ${code}, but the call succeeded`);
}

// ─── Outcomes ────────────────────────────────────────────────────────────────

describe('workspaces.switchWorkspace — outcomes', () => {
  test('first bind activates the target as the only workspace', async () => {
    const { sessionId, chatroomId } = await setupChatroom('switch-first-bind');
    await registerMachine(sessionId, 'machine-first-bind');

    const result = await switchWorkspace(sessionId, {
      chatroomId,
      machineId: 'machine-first-bind',
      workingDir: '/work/first',
    });

    expect(result.outcome).toBe('switched');
    expect(result.machineId).toBe('machine-first-bind');
    expect(result.workingDir).toBe('/work/first');
    expect(result.previousWorkspaceIds).toEqual([]);
    expect(result.agentsStopRequested).toBe(false);

    const active = await activeWorkspaces(chatroomId);
    expect(active).toHaveLength(1);
    expect(active[0]?._id).toBe(result.workspaceId);
    expect(await primaryWorkspaceId(chatroomId)).toBe(result.workspaceId);
  });

  test('cross-machine switch stops the old workspace and enqueues no auto-start', async () => {
    const { sessionId, chatroomId } = await setupChatroom('switch-cross-machine');
    await registerMachine(sessionId, 'machine-cross-a');
    await registerMachine(sessionId, 'machine-cross-b');
    const workspaceA = await bindWorkspace(sessionId, chatroomId, 'machine-cross-a', '/work/a');

    const result = await switchWorkspace(sessionId, {
      chatroomId,
      machineId: 'machine-cross-b',
      workingDir: '/work/b',
    });

    expect(result.outcome).toBe('switched');
    expect(result.previousWorkspaceIds).toEqual([workspaceA]);
    expect(result.agentsStopRequested).toBe(true);

    const oldRow = await workspaceRow(workspaceA);
    expect(oldRow?.removedAt).toBeTypeOf('number');
    const active = await activeWorkspaces(chatroomId);
    expect(active).toHaveLength(1);
    expect(active[0]?._id).toBe(result.workspaceId);
    expect(await primaryWorkspaceId(chatroomId)).toBe(result.workspaceId);

    const stops = await getInboxCommandsForChatroom(chatroomId, 'agent.stop');
    const oldWorkspaceStops = stops.filter(
      (row) => row.command.type === 'agent.stop' && row.command.workspaceId === workspaceA
    );
    expect(oldWorkspaceStops).toHaveLength(1);
    expect(oldWorkspaceStops[0]?.machineId).toBe('machine-cross-a');

    expect(await getGitRefreshCommandsForMachine('machine-cross-b', '/work/b')).toHaveLength(1);
    expect(await getInboxCommandsForMachine('machine-cross-b', 'agent.requestStart')).toHaveLength(
      0
    );
    expect(await getInboxCommandsForMachine('machine-cross-b', 'agent.restart')).toHaveLength(0);
  });

  test('same machine, different folder switches and reports that agents were stopped', async () => {
    const { sessionId, chatroomId } = await setupChatroom('switch-same-machine');
    await registerMachine(sessionId, 'machine-same');
    const workspaceA = await bindWorkspace(sessionId, chatroomId, 'machine-same', '/work/a');

    const result = await switchWorkspace(sessionId, {
      chatroomId,
      machineId: 'machine-same',
      workingDir: '/work/b',
    });

    expect(result.outcome).toBe('switched');
    expect(result.previousWorkspaceIds).toEqual([workspaceA]);
    expect(result.agentsStopRequested).toBe(true);
    expect(result.machineId).toBe('machine-same');
    expect(result.workingDir).toBe('/work/b');
    expect(await activeWorkspaces(chatroomId)).toHaveLength(1);
  });

  test('trailing slash on the active folder is a no-op after normalization', async () => {
    const { sessionId, chatroomId } = await setupChatroom('switch-trailing-slash');
    await registerMachine(sessionId, 'machine-trailing');
    const workspaceA = await bindWorkspace(sessionId, chatroomId, 'machine-trailing', '/work/a');

    const result = await switchWorkspace(sessionId, {
      chatroomId,
      machineId: 'machine-trailing',
      workingDir: '/work/a/',
    });

    expect(result.outcome).toBe('unchanged');
    expect(result.workspaceId).toBe(workspaceA);
    expect(result.workingDir).toBe('/work/a');
    expect(result.previousWorkspaceIds).toEqual([]);
    expect(await activeWorkspaces(chatroomId)).toHaveLength(1);
  });

  test('switch A → B → A reactivates the same document and carries configs back', async () => {
    const { sessionId, chatroomId } = await setupChatroom('switch-migrate-back');
    await registerMachine(sessionId, 'machine-back-a');
    await registerMachine(sessionId, 'machine-back-b');
    const workspaceA = await bindWorkspace(sessionId, chatroomId, 'machine-back-a', '/work/a');
    await saveConfig(sessionId, chatroomId, workspaceA, 'machine-back-a', 'builder', {
      model: 'model-a',
      workingDir: '/work/a',
    });

    const first = await switchWorkspace(sessionId, {
      chatroomId,
      machineId: 'machine-back-b',
      workingDir: '/work/b',
    });
    const workspaceB = first.workspaceId;
    expect(first.outcome).toBe('switched');
    expect((await workspaceRow(workspaceA))?.removedAt).toBeTypeOf('number');

    const second = await switchWorkspace(sessionId, {
      chatroomId,
      machineId: 'machine-back-a',
      workingDir: '/work/a',
    });

    expect(second.outcome).toBe('switched');
    expect(second.workspaceId).toBe(workspaceA);
    expect(second.previousWorkspaceIds).toEqual([workspaceB]);
    const reactivated = await workspaceRow(workspaceA);
    expect(reactivated?._id).toBe(workspaceA);
    expect(reactivated?.removedAt).toBeUndefined();
    expect((await workspaceRow(workspaceB))?.removedAt).toBeTypeOf('number');

    const active = await activeWorkspaces(chatroomId);
    expect(active).toHaveLength(1);
    expect(active[0]?._id).toBe(workspaceA);

    const configsOnA = await launchConfigsForWorkspace(workspaceA);
    expect(configsOnA).toHaveLength(1);
    expect(configsOnA[0]).toMatchObject({ role: 'builder', machineId: 'machine-back-a' });
    expect(await launchConfigsForWorkspace(workspaceB)).toHaveLength(0);
  });

  test('legacy multi-active rows normalize to one active workspace', async () => {
    const { sessionId, chatroomId } = await setupChatroom('switch-normalize-legacy');
    await registerMachine(sessionId, 'machine-legacy');
    const workspaceA = await bindWorkspace(sessionId, chatroomId, 'machine-legacy', '/work/a');
    const workspaceB = await seedWorkspace(chatroomId, 'machine-legacy', '/work/b');
    expect(await activeWorkspaces(chatroomId)).toHaveLength(2);

    const result = await switchWorkspace(sessionId, {
      chatroomId,
      machineId: 'machine-legacy',
      workingDir: '/work/c',
    });

    expect(result.outcome).toBe('switched');
    expect(result.previousWorkspaceIds).toHaveLength(2);
    expect(result.previousWorkspaceIds).toEqual(expect.arrayContaining([workspaceA, workspaceB]));
    expect(await activeWorkspaces(chatroomId)).toHaveLength(1);
  });
});

// ─── Launch-config migration ─────────────────────────────────────────────────

describe('workspaces.switchWorkspace — launch configs', () => {
  test('copies the departing config onto the target with the original settings', async () => {
    const { sessionId, chatroomId } = await setupChatroom('switch-config-copy');
    await registerMachine(sessionId, 'machine-copy-a');
    await registerMachine(sessionId, 'machine-copy-b');
    const workspaceA = await bindWorkspace(sessionId, chatroomId, 'machine-copy-a', '/work/a');
    await saveConfig(sessionId, chatroomId, workspaceA, 'machine-copy-a', 'builder', {
      model: 'anthropic/claude-opus-4',
      workingDir: '/work/a',
    });

    const result = await switchWorkspace(sessionId, {
      chatroomId,
      machineId: 'machine-copy-b',
      workingDir: '/work/b',
    });

    expect(result.configsMigrated).toEqual(['builder']);
    expect(result.configsSkipped).toEqual([]);

    const migrated = await t.query(api.agents.listLastSentLaunchRequests, {
      sessionId,
      chatroomId,
      workspaceId: result.workspaceId,
    });
    expect(migrated).toHaveLength(1);
    expect(migrated[0]).toMatchObject({
      role: 'builder',
      workspaceId: result.workspaceId,
      machineId: 'machine-copy-b',
      workingDir: '/work/b',
      agentHarness: 'opencode-sdk',
      model: 'anthropic/claude-opus-4',
      teamStructureId: 'duo@1',
      reason: 'workspace.switch',
      wantResume: false,
    });
    expect(await launchConfigsForWorkspace(workspaceA)).toHaveLength(0);
  });

  test('migrates and deletes a legacy un-scoped config row', async () => {
    const { sessionId, chatroomId } = await setupChatroom('switch-config-legacy');
    await registerMachine(sessionId, 'machine-legacy-cfg-a');
    await registerMachine(sessionId, 'machine-legacy-cfg-b');
    const workspaceA = await bindWorkspace(
      sessionId,
      chatroomId,
      'machine-legacy-cfg-a',
      '/work/a'
    );
    const userId = await t.run(async (ctx) => {
      const session = await ctx.db
        .query('sessions')
        .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
        .first();
      if (!session) throw new Error('session not found');
      return session.userId;
    });
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_agentLastSentLaunchRequests', {
        requestKey: `${chatroomId}:duo@1:builder`,
        requestId: 'legacy-request',
        commandId: 'legacy-command',
        chatroomId,
        teamStructureId: 'duo@1',
        role: 'builder',
        agentType: 'remote',
        machineId: 'machine-legacy-cfg-a',
        agentHarness: 'opencode-sdk',
        model: 'legacy-model',
        workingDir: '/work/a',
        reason: 'user.config',
        wantResume: false,
        requestedBy: userId,
        requestedAt: Date.now(),
      });
    });

    const result = await switchWorkspace(sessionId, {
      chatroomId,
      machineId: 'machine-legacy-cfg-b',
      workingDir: '/work/b',
    });

    expect(result.configsMigrated).toEqual(['builder']);
    const remaining = await allLaunchConfigs();
    expect(remaining.filter((row) => row.workspaceId === undefined)).toHaveLength(0);
    const migrated = await launchConfigsForWorkspace(result.workspaceId);
    expect(migrated).toHaveLength(1);
    expect(migrated[0]).toMatchObject({ role: 'builder', model: 'legacy-model' });
    expect(await launchConfigsForWorkspace(workspaceA)).toHaveLength(0);
  });

  test('skips a config whose harness the target machine does not offer', async () => {
    const { sessionId, chatroomId } = await setupChatroom('switch-config-harness');
    await registerMachine(sessionId, 'machine-harness-a', ['opencode-sdk', 'codex-sdk']);
    await registerMachine(sessionId, 'machine-harness-b', ['opencode-sdk']);
    const workspaceA = await bindWorkspace(sessionId, chatroomId, 'machine-harness-a', '/work/a');
    await saveConfig(sessionId, chatroomId, workspaceA, 'machine-harness-a', 'planner', {
      harness: 'codex-sdk',
      model: 'gpt-5',
      workingDir: '/work/a',
    });

    const result = await switchWorkspace(sessionId, {
      chatroomId,
      machineId: 'machine-harness-b',
      workingDir: '/work/b',
    });

    expect(result.configsSkipped).toEqual([{ role: 'planner', reason: 'harness_unavailable' }]);
    expect(result.configsMigrated).toEqual([]);
    expect(await launchConfigsForWorkspace(result.workspaceId)).toHaveLength(0);
    expect(await launchConfigsForWorkspace(workspaceA)).toHaveLength(0);
  });

  test('skips a custom-agent config and still deletes it', async () => {
    const { sessionId, chatroomId } = await setupChatroom('switch-config-custom');
    await registerMachine(sessionId, 'machine-custom-a');
    await registerMachine(sessionId, 'machine-custom-b');
    const workspaceA = await bindWorkspace(sessionId, chatroomId, 'machine-custom-a', '/work/a');
    const userId = await t.run(async (ctx) => {
      const session = await ctx.db
        .query('sessions')
        .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
        .first();
      if (!session) throw new Error('session not found');
      return session.userId;
    });
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_agentLastSentLaunchRequests', {
        requestKey: `${chatroomId}:duo@1:builder`,
        requestId: 'custom-request',
        commandId: 'custom-command',
        chatroomId,
        teamStructureId: 'duo@1',
        role: 'builder',
        agentType: 'custom',
        machineId: 'machine-custom-a',
        agentHarness: 'opencode-sdk',
        model: 'custom-model',
        workingDir: '/work/a',
        reason: 'user.config',
        wantResume: false,
        requestedBy: userId,
        requestedAt: Date.now(),
      });
    });

    const result = await switchWorkspace(sessionId, {
      chatroomId,
      machineId: 'machine-custom-b',
      workingDir: '/work/b',
    });

    expect(result.configsSkipped).toEqual([{ role: 'builder', reason: 'not_remote' }]);
    const remaining = await allLaunchConfigs();
    expect(remaining.filter((row) => row.machineId === 'machine-custom-a')).toHaveLength(0);
    expect(await launchConfigsForWorkspace(workspaceA)).toHaveLength(0);
  });

  test('keeps an existing target config and drops the departing one', async () => {
    const { sessionId, chatroomId } = await setupChatroom('switch-config-target');
    await registerMachine(sessionId, 'machine-target-a');
    await registerMachine(sessionId, 'machine-target-b');
    const workspaceA = await bindWorkspace(sessionId, chatroomId, 'machine-target-a', '/work/a');
    const workspaceB = await seedWorkspace(chatroomId, 'machine-target-b', '/work/b');
    await saveConfig(sessionId, chatroomId, workspaceA, 'machine-target-a', 'builder', {
      model: 'old-model',
      workingDir: '/work/a',
    });
    await saveConfig(sessionId, chatroomId, workspaceB, 'machine-target-b', 'builder', {
      model: 'target-model',
      workingDir: '/work/b',
    });
    const [targetBefore] = await launchConfigsForWorkspace(workspaceB);

    const result = await switchWorkspace(sessionId, {
      chatroomId,
      machineId: 'machine-target-b',
      workingDir: '/work/b',
    });

    expect(result.configsSkipped).toEqual([{ role: 'builder', reason: 'target_has_config' }]);
    const [targetAfter] = await launchConfigsForWorkspace(workspaceB);
    expect(targetAfter?._id).toBe(targetBefore?._id);
    expect(targetAfter?.model).toBe('target-model');
    expect(await launchConfigsForWorkspace(workspaceA)).toHaveLength(0);
  });
});

// ─── Role status and file-tree sync side effects ─────────────────────────────

describe('workspaces.switchWorkspace — status and file-tree side effects', () => {
  test('deletes status rows for the departing workspace only', async () => {
    const { sessionId, chatroomId } = await setupChatroom('switch-status-cleanup');
    const { sessionId: otherSessionId } = await createTestSession('switch-status-other');
    const otherChatroomId = await createDuoTeamChatroom(otherSessionId);
    await registerMachine(sessionId, 'machine-status');
    const workspaceA = await bindWorkspace(sessionId, chatroomId, 'machine-status', '/work/a');

    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_agentRoleStatusReadModel', {
        chatroomId,
        workspaceId: workspaceA,
        role: 'builder',
        roleKind: 'persistent',
        status: 'waiting',
        machineId: 'machine-status',
        projectedAt: now,
      });
      await ctx.db.insert('chatroom_agentRoleStatusReadModel', {
        chatroomId: otherChatroomId,
        role: 'planner',
        roleKind: 'persistent',
        status: 'waiting',
        machineId: 'machine-status',
        projectedAt: now,
      });
    });

    await switchWorkspace(sessionId, {
      chatroomId,
      machineId: 'machine-status',
      workingDir: '/work/b',
    });

    const statuses = await t.run((ctx) =>
      ctx.db.query('chatroom_agentRoleStatusReadModel').collect()
    );
    expect(statuses.filter((row) => row.chatroomId === chatroomId)).toHaveLength(0);
    expect(statuses.filter((row) => row.chatroomId === otherChatroomId)).toHaveLength(1);
  });

  test('carries the file-tree sync preference and releases the old lease', async () => {
    const { sessionId, chatroomId } = await setupChatroom('switch-file-tree');
    await registerMachine(sessionId, 'machine-tree-a');
    await registerMachine(sessionId, 'machine-tree-b');
    const workspaceA = await bindWorkspace(sessionId, chatroomId, 'machine-tree-a', '/work/a');
    await t.mutation(api.workspaces.setFileTreeSyncEnabled, {
      sessionId,
      workspaceId: workspaceA,
      enabled: true,
    });
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceFileTreeWatches', {
        machineId: 'machine-tree-a',
        workingDir: '/work/a',
        watchCount: 3,
        expiresAt: now + 60_000,
        updatedAt: now,
      });
    });

    const result = await switchWorkspace(sessionId, {
      chatroomId,
      machineId: 'machine-tree-b',
      workingDir: '/work/b',
    });

    const target = await workspaceRow(result.workspaceId);
    expect(target?.fileTreeSyncEnabled).toBe(true);

    const watch = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_workspaceFileTreeWatches')
        .withIndex('by_machine_workingDir', (q) =>
          q.eq('machineId', 'machine-tree-a').eq('workingDir', '/work/a')
        )
        .first()
    );
    expect(watch?.watchCount).toBe(0);
    expect(watch?.expiresAt).toBeUndefined();

    const release = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_workspaceFileTreeReleaseRequests')
        .withIndex('by_machine_workingDir', (q) =>
          q.eq('machineId', 'machine-tree-a').eq('workingDir', '/work/a')
        )
        .first()
    );
    expect(release).not.toBeNull();
  });
});

// ─── Idempotency, conflict, and atomicity ────────────────────────────────────

describe('workspaces.switchWorkspace — idempotency and conflict', () => {
  test('switching to the same target twice writes nothing the second time', async () => {
    const { sessionId, chatroomId } = await setupChatroom('switch-idempotent');
    await registerMachine(sessionId, 'machine-idem-a');
    await registerMachine(sessionId, 'machine-idem-b');
    const workspaceA = await bindWorkspace(sessionId, chatroomId, 'machine-idem-a', '/work/a');
    await saveConfig(sessionId, chatroomId, workspaceA, 'machine-idem-a', 'builder', {
      workingDir: '/work/a',
    });

    const first = await switchWorkspace(sessionId, {
      chatroomId,
      machineId: 'machine-idem-b',
      workingDir: '/work/b',
    });
    expect(first.outcome).toBe('switched');

    const countsBefore = await counts();
    const second = await switchWorkspace(sessionId, {
      chatroomId,
      machineId: 'machine-idem-b',
      workingDir: '/work/b',
    });

    expect(second.outcome).toBe('unchanged');
    expect(second.previousWorkspaceIds).toEqual([]);
    expect(second.configsMigrated).toEqual([]);
    expect(await counts()).toEqual(countsBefore);
  });

  test('a stale expectedWorkspaceId conflicts without writing', async () => {
    const { sessionId, chatroomId } = await setupChatroom('switch-conflict-stale');
    await registerMachine(sessionId, 'machine-conflict-a');
    await registerMachine(sessionId, 'machine-conflict-b');
    await bindWorkspace(sessionId, chatroomId, 'machine-conflict-a', '/work/a');

    const foreign = await createDuoTeamChatroom(sessionId);
    const foreignWorkspace = await bindWorkspace(
      sessionId,
      foreign,
      'machine-conflict-b',
      '/work/foreign'
    );

    const before = await snapshotTables();
    const data = await expectCode(
      switchWorkspace(sessionId, {
        chatroomId,
        machineId: 'machine-conflict-b',
        workingDir: '/work/b',
        expectedWorkspaceId: foreignWorkspace,
      }),
      'WORKSPACE_SWITCH_CONFLICT'
    );
    expect(data.message).toContain('Reload');
    expect(await snapshotTables()).toBe(before);
  });

  test('expecting no active workspace conflicts while one exists', async () => {
    const { sessionId, chatroomId } = await setupChatroom('switch-conflict-null');
    await registerMachine(sessionId, 'machine-conflict-null-a');
    await bindWorkspace(sessionId, chatroomId, 'machine-conflict-null-a', '/work/a');

    const before = await snapshotTables();
    await expectCode(
      switchWorkspace(sessionId, {
        chatroomId,
        machineId: 'machine-conflict-null-a',
        workingDir: '/work/b',
        expectedWorkspaceId: null,
      }),
      'WORKSPACE_SWITCH_CONFLICT'
    );
    expect(await snapshotTables()).toBe(before);
  });

  test('rejects foreign chatrooms, foreign machines, unknown machines, and bad paths without writing', async () => {
    const { sessionId, chatroomId } = await setupChatroom('switch-auth-owner');
    const { sessionId: intruderId } = await createTestSession('switch-auth-intruder');
    await registerMachine(sessionId, 'machine-auth-owner');
    await registerMachine(intruderId, 'machine-auth-intruder');

    const before = await snapshotTables();

    await expectCode(
      switchWorkspace(intruderId, {
        chatroomId,
        machineId: 'machine-auth-intruder',
        workingDir: '/work/hijack',
      }),
      'ACCESS_DENIED'
    );

    await expectCode(
      switchWorkspace(sessionId, {
        chatroomId,
        machineId: 'machine-auth-intruder',
        workingDir: '/work/foreign-machine',
      }),
      'NOT_AUTHORIZED_MACHINE'
    );

    await expectCode(
      switchWorkspace(sessionId, {
        chatroomId,
        machineId: 'machine-does-not-exist',
        workingDir: '/work/unknown',
      }),
      'NOT_AUTHORIZED_MACHINE'
    );

    for (const workingDir of ['relative/path', '/work/a;rm', '/']) {
      await expectCode(
        switchWorkspace(sessionId, {
          chatroomId,
          machineId: 'machine-auth-owner',
          workingDir,
        }),
        'INVALID_WORKING_DIR'
      );
    }

    expect(await snapshotTables()).toBe(before);
  });
});

async function counts(): Promise<{ workspaces: number; configs: number; inbox: number }> {
  return t.run(async (ctx) => ({
    workspaces: (await ctx.db.query('chatroom_workspaces').collect()).length,
    configs: (await ctx.db.query('chatroom_agentLastSentLaunchRequests').collect()).length,
    inbox: (await ctx.db.query('chatroom_machineCommandInbox').collect()).length,
  }));
}

// ─── Registration cap at the mutation boundary ──────────────────────────────

describe('workspaces.registerWorkspace — one-workspace policy', () => {
  test('accepts the first workspace and refuses a second distinct one', async () => {
    const { sessionId, chatroomId } = await setupChatroom('cap-register');
    await registerMachine(sessionId, 'machine-cap');

    const firstId = await bindWorkspace(sessionId, chatroomId, 'machine-cap', '/work/a');
    expect(firstId).toBeTypeOf('string');

    const data = await expectCode(
      bindWorkspace(sessionId, chatroomId, 'machine-cap', '/work/b'),
      'WORKSPACE_ALREADY_BOUND'
    );
    expect(data.message).toContain('/work/a');
    expect(await allWorkspaces(chatroomId)).toHaveLength(1);
  });

  test('re-registering the active triple is a no-op with no inbox row', async () => {
    const { sessionId, chatroomId } = await setupChatroom('cap-same-triple');
    await registerMachine(sessionId, 'machine-cap-same');
    const firstId = await bindWorkspace(sessionId, chatroomId, 'machine-cap-same', '/work/a');
    const gitRefreshesBefore = (
      await getGitRefreshCommandsForMachine('machine-cap-same', '/work/a')
    ).length;

    const secondId = await bindWorkspace(sessionId, chatroomId, 'machine-cap-same', '/work/a');

    expect(secondId).toBe(firstId);
    expect(await allWorkspaces(chatroomId)).toHaveLength(1);
    expect((await getGitRefreshCommandsForMachine('machine-cap-same', '/work/a')).length).toBe(
      gitRefreshesBefore
    );
  });

  test('refuses reactivating a removed triple while another workspace is active', async () => {
    const { sessionId, chatroomId } = await setupChatroom('cap-reactivate');
    await registerMachine(sessionId, 'machine-cap-reactivate');
    await bindWorkspace(sessionId, chatroomId, 'machine-cap-reactivate', '/work/a');
    const workspaceB = await seedWorkspace(chatroomId, 'machine-cap-reactivate', '/work/b');
    await t.mutation(api.workspaces.removeWorkspace, {
      sessionId,
      workspaceId: workspaceB,
    });

    await expectCode(
      bindWorkspace(sessionId, chatroomId, 'machine-cap-reactivate', '/work/b'),
      'WORKSPACE_ALREADY_BOUND'
    );
    expect(await activeWorkspaces(chatroomId)).toHaveLength(1);
  });

  test('accepts the first workspace on an empty chatroom', async () => {
    const { sessionId, chatroomId } = await setupChatroom('cap-empty');
    await registerMachine(sessionId, 'machine-cap-empty');

    const workspaceId = await bindWorkspace(sessionId, chatroomId, 'machine-cap-empty', '/work/a');
    expect(await activeWorkspaces(chatroomId)).toHaveLength(1);
    expect(await activeWorkspaces(chatroomId)).toEqual([
      expect.objectContaining({ _id: workspaceId }),
    ]);
  });
});
