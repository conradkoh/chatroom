import { describe, expect, test } from 'vitest';

import { migrateLegacyBuilderConfigRow } from './migrate-legacy-builder-config';
import { api } from '../../../../convex/_generated/api';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { t } from '../../../../test.setup';
import { createTestSession } from '../../../../tests/helpers/integration';

async function setupBuilderChatroom(sessionId: string) {
  await t.mutation(api.auth.loginAnon, { sessionId: sessionId as any });
  const chatroomId = await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
  return chatroomId;
}

async function insertConfig(
  chatroomId: any,
  role: string,
  overrides: { desiredState?: string; spawnedAgentPid?: number }
) {
  const now = Date.now();
  const id = await t.run((ctx) =>
    ctx.db.insert('chatroom_teamAgentConfigs', {
      teamRoleKey: buildTeamRoleKey(chatroomId, 'duo', role),
      chatroomId,
      role,
      type: 'remote',
      machineId: 'machine-x',
      agentHarness: 'opencode',
      model: 'test-model',
      workingDir: '/workspace',
      enabled: true,
      desiredState: overrides.desiredState ?? 'stopped',
      lifecycleRevision: 0,
      createdAt: now,
      updatedAt: now,
      ...(overrides.spawnedAgentPid !== undefined
        ? { spawnedAgentPid: overrides.spawnedAgentPid, spawnedAt: now }
        : {}),
    })
  );
  return id;
}

async function configFor(chatroomId: any, role: string) {
  return t.run((ctx) =>
    ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', role))
      )
      .first()
  );
}

describe('builder ephemeral migration', () => {
  test('clears PID and forces stopped for a running legacy builder config', async () => {
    const sessionId = 'builder-migration-running';
    const chatroomId = await setupBuilderChatroom(sessionId);
    const id = await insertConfig(chatroomId, 'builder', {
      desiredState: 'running',
      spawnedAgentPid: 4242,
    });

    await t.run((ctx) =>
      migrateLegacyBuilderConfigRow(ctx, {
        ...(undefined as never),
        _id: id,
        _creationTime: 0,
        teamRoleKey: buildTeamRoleKey(chatroomId, 'duo', 'builder'),
        chatroomId,
        role: 'builder',
        type: 'remote',
        machineId: 'machine-x',
        agentHarness: 'opencode',
        model: 'test-model',
        workingDir: '/workspace',
        enabled: true,
        desiredState: 'running',
        spawnedAgentPid: 4242,
        spawnedAt: Date.now(),
        lifecycleRevision: 0,
        createdAt: 0,
        updatedAt: 0,
      })
    );

    const config = await configFor(chatroomId, 'builder');
    expect(config?.desiredState).toBe('stopped');
    expect(config?.wantResume).toBe(false);
    expect(config?.spawnedAgentPid).toBeUndefined();
    expect(config?.spawnedAt).toBeUndefined();
  });

  test('leaves an already-stopped builder config untouched', async () => {
    const sessionId = 'builder-migration-stopped';
    const chatroomId = await setupBuilderChatroom(sessionId);
    const id = await insertConfig(chatroomId, 'builder', { desiredState: 'stopped' });

    await t.run((ctx) =>
      migrateLegacyBuilderConfigRow(ctx, {
        ...(undefined as never),
        _id: id,
        _creationTime: 0,
        teamRoleKey: buildTeamRoleKey(chatroomId, 'duo', 'builder'),
        chatroomId,
        role: 'builder',
        type: 'remote',
        machineId: 'machine-x',
        agentHarness: 'opencode',
        model: 'test-model',
        workingDir: '/workspace',
        enabled: true,
        desiredState: 'stopped',
        lifecycleRevision: 0,
        createdAt: 0,
        updatedAt: 0,
      })
    );

    const config = await configFor(chatroomId, 'builder');
    expect(config?.desiredState).toBe('stopped');
    expect(config?.spawnedAgentPid).toBeUndefined();
  });

  test('does not touch a running planner config', async () => {
    const sessionId = 'builder-migration-planner';
    const chatroomId = await setupBuilderChatroom(sessionId);
    const id = await insertConfig(chatroomId, 'planner', {
      desiredState: 'running',
      spawnedAgentPid: 9999,
    });

    await t.run((ctx) =>
      migrateLegacyBuilderConfigRow(ctx, {
        ...(undefined as never),
        _id: id,
        _creationTime: 0,
        teamRoleKey: buildTeamRoleKey(chatroomId, 'duo', 'planner'),
        chatroomId,
        role: 'planner',
        type: 'remote',
        machineId: 'machine-x',
        agentHarness: 'opencode',
        model: 'test-model',
        workingDir: '/workspace',
        enabled: true,
        desiredState: 'running',
        spawnedAgentPid: 9999,
        spawnedAt: Date.now(),
        lifecycleRevision: 0,
        createdAt: 0,
        updatedAt: 0,
      })
    );

    const config = await configFor(chatroomId, 'planner');
    expect(config?.desiredState).toBe('running');
    expect(config?.spawnedAgentPid).toBe(9999);
  });

  test('does not touch a running builder config outside the Duo team', async () => {
    const sessionId = 'builder-migration-custom-team';
    await createTestSession(sessionId);
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'custom-team',
      teamName: 'Custom Team',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });
    const now = Date.now();
    const id = await t.run((ctx) =>
      ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: buildTeamRoleKey(chatroomId, 'custom-team', 'builder'),
        chatroomId,
        role: 'builder',
        type: 'remote',
        machineId: 'machine-x',
        agentHarness: 'opencode',
        model: 'test-model',
        workingDir: '/workspace',
        enabled: true,
        desiredState: 'running',
        spawnedAgentPid: 1234,
        spawnedAt: now,
        lifecycleRevision: 0,
        createdAt: now,
        updatedAt: now,
      })
    );

    await t.run((ctx) =>
      migrateLegacyBuilderConfigRow(ctx, {
        ...(undefined as never),
        _id: id,
        _creationTime: 0,
        teamRoleKey: buildTeamRoleKey(chatroomId, 'custom-team', 'builder'),
        chatroomId,
        role: 'builder',
        type: 'remote',
        machineId: 'machine-x',
        agentHarness: 'opencode',
        model: 'test-model',
        workingDir: '/workspace',
        enabled: true,
        desiredState: 'running',
        spawnedAgentPid: 1234,
        spawnedAt: now,
        lifecycleRevision: 0,
        createdAt: 0,
        updatedAt: 0,
      })
    );

    const config = await t.run((ctx) => ctx.db.get('chatroom_teamAgentConfigs', id));
    expect(config?.desiredState).toBe('running');
    expect(config?.spawnedAgentPid).toBe(1234);
  });
});
