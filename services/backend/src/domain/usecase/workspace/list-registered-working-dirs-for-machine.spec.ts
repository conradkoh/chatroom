/**
 * Unit tests for listRegisteredWorkingDirsForMachine.
 *
 * Each test uses its own machineId: the test DB is shared across tests in this file.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { listRegisteredWorkingDirsForMachine } from './list-registered-working-dirs-for-machine';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';

const FIXED_NOW = 1_800_000_000_000;

async function createSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId };
}

async function createChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Test Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
}

async function registerMachine(sessionId: SessionId, machineId: string) {
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test-host',
    os: 'linux',
    availableHarnesses: ['opencode'],
  });
}

async function setupMachine(suffix: string) {
  const { sessionId } = await createSession(`registered-${suffix}`);
  const machineId = `registered-machine-${suffix}`;
  await registerMachine(sessionId, machineId);
  return { sessionId, machineId };
}

async function registerWorkspace(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string,
  workingDir: string
) {
  return t.mutation(api.workspaces.registerWorkspace, {
    sessionId,
    chatroomId,
    machineId,
    workingDir,
    hostname: 'test-host',
    registeredBy: 'builder',
  });
}

async function recordObservation(chatroomId: Id<'chatroom_rooms'>, lastObservedAt: number) {
  await t.run(async (ctx) => {
    await ctx.db.insert('chatroom_observation', { chatroomId, lastObservedAt });
  });
}

function registeredDirsFor(machineId: string) {
  return t.run(async (ctx) => listRegisteredWorkingDirsForMachine(ctx, { machineId }));
}

describe('listRegisteredWorkingDirsForMachine', () => {
  test('excludes removed workspaces', async () => {
    const { sessionId, machineId } = await setupMachine('removed');
    const chatroomId = await createChatroom(sessionId);
    const workspaceId = await registerWorkspace(
      sessionId,
      chatroomId,
      machineId,
      '/tmp/reg-removed'
    );
    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_workspaces', workspaceId, { removedAt: FIXED_NOW - 1_000 });
    });

    expect(await registeredDirsFor(machineId)).toEqual([]);
  });

  test('excludes workspaces registered to another machine', async () => {
    const { sessionId, machineId } = await setupMachine('own-machine');
    const otherMachineId = 'registered-machine-other';
    await registerMachine(sessionId, otherMachineId);
    const chatroomId = await createChatroom(sessionId);
    await registerWorkspace(sessionId, chatroomId, otherMachineId, '/tmp/reg-foreign');

    expect(await registeredDirsFor(machineId)).toEqual([]);
    expect(await registeredDirsFor(otherMachineId)).toEqual(['/tmp/reg-foreign']);
  });

  test('deduplicates a workingDir shared by two chatrooms', async () => {
    const { sessionId, machineId } = await setupMachine('dedupe');
    const first = await createChatroom(sessionId);
    const second = await createChatroom(sessionId);
    await registerWorkspace(sessionId, first, machineId, '/tmp/reg-shared');
    await registerWorkspace(sessionId, second, machineId, '/tmp/reg-shared');

    expect(await registeredDirsFor(machineId)).toEqual(['/tmp/reg-shared']);
  });

  test('sorts results ascending regardless of insertion order', async () => {
    const { sessionId, machineId } = await setupMachine('sorted');
    const chatroomId = await createChatroom(sessionId);
    await registerWorkspace(sessionId, chatroomId, machineId, '/tmp/reg-c');
    await registerWorkspace(sessionId, chatroomId, machineId, '/tmp/reg-a');
    await registerWorkspace(sessionId, chatroomId, machineId, '/tmp/reg-b');

    expect(await registeredDirsFor(machineId)).toEqual(['/tmp/reg-a', '/tmp/reg-b', '/tmp/reg-c']);
  });

  test('returns the same result with and without observation rows', async () => {
    const { sessionId, machineId } = await setupMachine('no-observation-dependency');
    const chatroomId = await createChatroom(sessionId);
    await registerWorkspace(sessionId, chatroomId, machineId, '/tmp/reg-observed');

    const withoutObservation = await registeredDirsFor(machineId);
    await recordObservation(chatroomId, FIXED_NOW);
    const withObservation = await registeredDirsFor(machineId);

    expect(withoutObservation).toEqual(['/tmp/reg-observed']);
    expect(withObservation).toEqual(withoutObservation);
  });
});
