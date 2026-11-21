/**
 * Machine usage + last-seen queries — Integration Tests
 *
 * 1. getMachineUsage counts active workspaces and distinct chatrooms, capped at 500
 * 2. It is owner-scoped and empty for unauthenticated callers
 * 3. listMachineLastSeen is null while online (never reads liveness) and returns the
 *    liveness timestamp once the machine is offline
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { MACHINE_USAGE_SCAN_CAP } from '../../src/domain/usecase/machine/machine-usage';
import { t } from '../../test.setup';
import {
  createDuoTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
} from '../helpers/integration';

async function registerMachine(sessionId: SessionId, machineId: string): Promise<void> {
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test-host',
    os: 'darwin',
    availableHarnesses: ['opencode-sdk'],
  });
}

/** Seed a workspace row directly so usage tests do not depend on chatroom access rules. */
async function seedWorkspace(
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string,
  workingDir: string,
  removedAt?: number
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('chatroom_workspaces', {
      chatroomId,
      machineId,
      workingDir,
      hostname: 'test-host',
      registeredAt: Date.now(),
      registeredBy: 'builder',
      ...(removedAt !== undefined ? { removedAt } : {}),
    });
  });
}

describe('getMachineUsage', () => {
  test('counts only active workspaces and distinct chatrooms', async () => {
    const { sessionId } = await createTestSession('test-usage-owner');
    await registerMachine(sessionId, 'machine-usage-owner');

    const chatroomA = await createDuoTeamChatroom(sessionId);
    const chatroomB = await createDuoTeamChatroom(sessionId);

    await seedWorkspace(chatroomA, 'machine-usage-owner', '/work/a');
    await seedWorkspace(chatroomA, 'machine-usage-owner', '/work/b');
    await seedWorkspace(chatroomB, 'machine-usage-owner', '/work/c');
    await seedWorkspace(chatroomB, 'machine-usage-owner', '/work/removed', Date.now());

    const result = await t.query(api.machines.getMachineUsage, { sessionId });

    expect(result.machines).toEqual([
      {
        machineId: 'machine-usage-owner',
        activeWorkspaceCount: 3,
        activeChatroomCount: 2,
        capped: false,
      },
    ]);
  });

  test('is owner-scoped', async () => {
    const { sessionId: ownerSessionId } = await createTestSession('test-usage-scope-owner');
    const { sessionId: otherSessionId } = await createTestSession('test-usage-scope-other');
    await registerMachine(ownerSessionId, 'machine-usage-scoped');

    const chatroomId = await createDuoTeamChatroom(ownerSessionId);
    await seedWorkspace(chatroomId, 'machine-usage-scoped', '/work/owned');

    const other = await t.query(api.machines.getMachineUsage, { sessionId: otherSessionId });
    expect(other.machines).toEqual([]);

    const owner = await t.query(api.machines.getMachineUsage, { sessionId: ownerSessionId });
    expect(owner.machines).toEqual([
      {
        machineId: 'machine-usage-scoped',
        activeWorkspaceCount: 1,
        activeChatroomCount: 1,
        capped: false,
      },
    ]);
  });

  test('caps counts at 500 active workspaces', async () => {
    const { sessionId } = await createTestSession('test-usage-capped');
    await registerMachine(sessionId, 'machine-usage-capped');

    const chatroomId = await createDuoTeamChatroom(sessionId);
    await t.run(async (ctx) => {
      for (let i = 0; i < MACHINE_USAGE_SCAN_CAP + 1; i++) {
        await ctx.db.insert('chatroom_workspaces', {
          chatroomId,
          machineId: 'machine-usage-capped',
          workingDir: `/work/capped-${i}`,
          hostname: 'test-host',
          registeredAt: Date.now(),
          registeredBy: 'builder',
        });
      }
    });

    const result = await t.query(api.machines.getMachineUsage, { sessionId });

    expect(result.machines).toEqual([
      {
        machineId: 'machine-usage-capped',
        activeWorkspaceCount: MACHINE_USAGE_SCAN_CAP,
        activeChatroomCount: 1,
        capped: true,
      },
    ]);
  });

  test('returns no machines for an unauthenticated caller', async () => {
    const result = await t.query(api.machines.getMachineUsage, { sessionId: 'not-a-session' });
    expect(result).toEqual({ machines: [] });
  });
});

describe('listMachineLastSeen', () => {
  test('is null while online, even when liveness changes', async () => {
    const { sessionId } = await createTestSession('test-lastseen-online');
    await registerMachineWithDaemon(sessionId, 'machine-lastseen-online');

    await t.run(async (ctx) => {
      const liveness = await ctx.db
        .query('chatroom_machineLiveness')
        .withIndex('by_machineId', (q) => q.eq('machineId', 'machine-lastseen-online'))
        .first();
      await ctx.db.patch('chatroom_machineLiveness', liveness!._id, { lastSeenAt: 123 });
    });

    const result = await t.query(api.machines.listMachineLastSeen, { sessionId });
    expect(result.machines).toEqual([{ machineId: 'machine-lastseen-online', lastSeenAt: null }]);
  });

  test('returns the liveness timestamp once offline', async () => {
    const { sessionId } = await createTestSession('test-lastseen-offline');
    await registerMachineWithDaemon(sessionId, 'machine-lastseen-offline');
    await t.mutation(api.machines.markDaemonOffline, {
      sessionId,
      machineId: 'machine-lastseen-offline',
    });

    const liveness = await t.run(
      async (ctx) =>
        await ctx.db
          .query('chatroom_machineLiveness')
          .withIndex('by_machineId', (q) => q.eq('machineId', 'machine-lastseen-offline'))
          .first()
    );

    const result = await t.query(api.machines.listMachineLastSeen, { sessionId });
    expect(result.machines).toEqual([
      { machineId: 'machine-lastseen-offline', lastSeenAt: liveness!.lastSeenAt },
    ]);
  });

  test('is null for an offline machine without a liveness row', async () => {
    const { sessionId } = await createTestSession('test-lastseen-missing');
    await registerMachine(sessionId, 'machine-lastseen-missing');

    const result = await t.query(api.machines.listMachineLastSeen, { sessionId });
    expect(result.machines).toEqual([{ machineId: 'machine-lastseen-missing', lastSeenAt: null }]);
  });

  test('returns no machines for an unauthenticated caller', async () => {
    const result = await t.query(api.machines.listMachineLastSeen, { sessionId: 'not-a-session' });
    expect(result).toEqual({ machines: [] });
  });
});
