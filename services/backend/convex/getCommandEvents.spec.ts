/**
 * getCommandEvents — Integration Tests
 *
 * Verifies that the getCommandEvents query returns the correct events
 * filtered by machineId and event type, with cursor support.
 *
 * Tests follow TDD order: written before the query implementation.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { expect, test } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { enqueueMachineCommand } from '../src/domain/usecase/machine/enqueue-machine-command';
import { TEST_MODEL_OPENCODE } from '../tests/helpers/test-models';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTestSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId, userId: login.userId as Id<'users'> };
}

async function createChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo Team',
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

async function insertCommandEvent(
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string,
  type: 'agent.requestStart' | 'agent.requestStop'
): Promise<Id<'chatroom_machineCommandInbox'>> {
  return await t.run(async (ctx) =>
    type === 'agent.requestStart'
      ? enqueueMachineCommand(ctx, {
          machineId,
          command: {
            type,
            chatroomId,
            role: 'builder',
            agentHarness: 'opencode',
            model: TEST_MODEL_OPENCODE,
            workingDir: '/tmp/test',
            reason: 'test',
          },
        })
      : enqueueMachineCommand(ctx, {
          machineId,
          command: { type, chatroomId, role: 'builder', reason: 'test' },
        })
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Test 1: Empty result when no command events exist
test('getCommandEvents — returns empty when no command events exist', async () => {
  const { sessionId } = await createTestSession('gce-1');
  const machineId = 'machine-gce-1';
  await registerMachine(sessionId, machineId);

  const result = await t.query(api.machines.getCommandEvents, {
    sessionId,
    machineId,
  });

  expect(result.events).toHaveLength(0);
});

// Test 2: Returns agent.requestStart events
test('getCommandEvents — returns agent.requestStart event for the machine', async () => {
  const { sessionId } = await createTestSession('gce-2');
  const chatroomId = await createChatroom(sessionId);
  const machineId = 'machine-gce-2';
  await registerMachine(sessionId, machineId);

  await insertCommandEvent(chatroomId, machineId, 'agent.requestStart');

  const result = await t.query(api.machines.getCommandEvents, {
    sessionId,
    machineId,
  });

  expect(result.events).toHaveLength(1);
  expect(result.events[0].type).toBe('agent.requestStart');
});

// Test 3: Returns agent.requestStop events
test('getCommandEvents — returns agent.requestStop event for the machine', async () => {
  const { sessionId } = await createTestSession('gce-3');
  const chatroomId = await createChatroom(sessionId);
  const machineId = 'machine-gce-3';
  await registerMachine(sessionId, machineId);

  await insertCommandEvent(chatroomId, machineId, 'agent.requestStop');

  const result = await t.query(api.machines.getCommandEvents, {
    sessionId,
    machineId,
  });

  expect(result.events).toHaveLength(1);
  expect(result.events[0].type).toBe('agent.requestStop');
});

// Test 4: machineId filter — events for a different machine are NOT returned
test('getCommandEvents — filters out events for other machines', async () => {
  const { sessionId } = await createTestSession('gce-4');
  const chatroomId = await createChatroom(sessionId);
  const machineId = 'machine-gce-4';
  const otherMachineId = 'machine-gce-4-other';
  await registerMachine(sessionId, machineId);

  // Insert event for the OTHER machine
  await insertCommandEvent(chatroomId, otherMachineId, 'agent.requestStart');

  const result = await t.query(api.machines.getCommandEvents, {
    sessionId,
    machineId,
  });

  expect(result.events).toHaveLength(0);
});

// Test 5b: Returns all deadline-valid agent.requestStart events per chatroom+role
// (daemon kill-then-spawn handles duplicates; backend does not collapse)
test('getCommandEvents — returns all agent.requestStart events for same chatroom+role', async () => {
  const { sessionId } = await createTestSession('gce-5b');
  const chatroomId = await createChatroom(sessionId);
  const machineId = 'machine-gce-5b';
  await registerMachine(sessionId, machineId);

  const olderId = await insertCommandEvent(chatroomId, machineId, 'agent.requestStart');
  const newerId = await insertCommandEvent(chatroomId, machineId, 'agent.requestStart');

  const result = await t.query(api.machines.getCommandEvents, {
    sessionId,
    machineId,
  });

  const startEvents = result.events.filter((e) => e.type === 'agent.requestStart');
  expect(startEvents).toHaveLength(2);
  expect(startEvents.map((e) => e._id)).toContain(olderId);
  expect(startEvents.map((e) => e._id)).toContain(newerId);
});

// Test 6: Multiple command events — all returned together
test('getCommandEvents — returns both agent.requestStart and agent.requestStop events together', async () => {
  const { sessionId } = await createTestSession('gce-6');
  const chatroomId = await createChatroom(sessionId);
  const machineId = 'machine-gce-6';
  await registerMachine(sessionId, machineId);

  await insertCommandEvent(chatroomId, machineId, 'agent.requestStart');
  await insertCommandEvent(chatroomId, machineId, 'agent.requestStop');

  // Both events have valid deadlines, so both should appear
  const result = await t.query(api.machines.getCommandEvents, {
    sessionId,
    machineId,
  });

  expect(result.events).toHaveLength(2);
  expect(result.events.map((e) => e.type)).toContain('agent.requestStart');
  expect(result.events.map((e) => e.type)).toContain('agent.requestStop');
});

// Test 7: Unauthenticated request returns empty
test('getCommandEvents — unauthenticated request returns empty', async () => {
  const result = await t.query(api.machines.getCommandEvents, {
    sessionId: 'invalid-session-id' as SessionId,
    machineId: 'any-machine',
  });

  expect(result.events).toHaveLength(0);
});

// Test 8: Expired start/stop events are excluded (deadline < now)
test('getCommandEvents — expired agent.requestStart/Stop events are NOT returned', async () => {
  const { sessionId } = await createTestSession('gce-8');
  const chatroomId = await createChatroom(sessionId);
  const machineId = 'machine-gce-8';
  await registerMachine(sessionId, machineId);

  await t.run(async (ctx) =>
    enqueueMachineCommand(ctx, {
      machineId,
      now: Date.now() - 10 * 60_000,
      command: { type: 'agent.requestStop', chatroomId, role: 'builder', reason: 'test' },
    })
  );

  const result = await t.query(api.machines.getCommandEvents, {
    sessionId,
    machineId,
  });

  expect(result.events).toHaveLength(0);
});

// Test 9a: daemon.pickFolder events are returned for the machine
test('getCommandEvents — returns daemon.pickFolder event for the machine', async () => {
  const { sessionId, userId } = await createTestSession('gce-9a');
  const machineId = 'machine-gce-9a';
  await registerMachine(sessionId, machineId);

  const requestId = await t.run(async (ctx) => {
    const id = await ctx.db.insert('chatroom_folderPickerRequests', {
      userId,
      machineId,
      status: 'pending',
      createdAt: Date.now(),
    });
    await enqueueMachineCommand(ctx, {
      machineId,
      command: { type: 'daemon.pickFolder', requestId: id },
    });
    return id;
  });

  const result = await t.query(api.machines.getCommandEvents, {
    sessionId,
    machineId,
  });

  const pickFolderEvents = result.events.filter((e) => e.type === 'daemon.pickFolder');
  expect(pickFolderEvents).toHaveLength(1);
  if (pickFolderEvents[0].type === 'daemon.pickFolder') {
    expect(pickFolderEvents[0].requestId).toBe(requestId);
  }
});

// Test 9b: daemon.pickFolder events for other machines are NOT returned
test('getCommandEvents — filters out daemon.pickFolder events for other machines', async () => {
  const { sessionId, userId } = await createTestSession('gce-9b');
  const machineId = 'machine-gce-9b';
  const otherMachineId = 'machine-gce-9b-other';
  await registerMachine(sessionId, machineId);

  await t.run(async (ctx) => {
    const requestId = await ctx.db.insert('chatroom_folderPickerRequests', {
      userId,
      machineId: otherMachineId,
      status: 'pending',
      createdAt: Date.now(),
    });
    await enqueueMachineCommand(ctx, {
      machineId: otherMachineId,
      command: { type: 'daemon.pickFolder', requestId },
    });
  });

  const result = await t.query(api.machines.getCommandEvents, {
    sessionId,
    machineId,
  });

  expect(result.events.filter((e) => e.type === 'daemon.pickFolder')).toHaveLength(0);
});

// Test 9c: expired daemon.pickFolder events are NOT returned
test('getCommandEvents — expired daemon.pickFolder events are NOT returned', async () => {
  const { sessionId, userId } = await createTestSession('gce-9c');
  const machineId = 'machine-gce-9c';
  await registerMachine(sessionId, machineId);

  await t.run(async (ctx) => {
    const requestId = await ctx.db.insert('chatroom_folderPickerRequests', {
      userId,
      machineId,
      status: 'pending',
      createdAt: Date.now(),
    });
    await enqueueMachineCommand(ctx, {
      machineId,
      now: Date.now() - 10 * 60_000,
      command: { type: 'daemon.pickFolder', requestId },
    });
  });

  const result = await t.query(api.machines.getCommandEvents, {
    sessionId,
    machineId,
  });

  expect(result.events.filter((e) => e.type === 'daemon.pickFolder')).toHaveLength(0);
});

// Test 9: daemon.ping events are returned without cursor filtering
test('getCommandEvents — all daemon.ping events are returned (no cursor filter)', async () => {
  const { sessionId } = await createTestSession('gce-9');
  const machineId = 'machine-gce-9';
  await registerMachine(sessionId, machineId);

  // Insert two ping events
  await t.run(async (ctx) => {
    await enqueueMachineCommand(ctx, { machineId, command: { type: 'daemon.ping' } });
    await enqueueMachineCommand(ctx, { machineId, command: { type: 'daemon.ping' } });
  });

  // Both pings should be returned — no cursor filtering
  const result = await t.query(api.machines.getCommandEvents, {
    sessionId,
    machineId,
  });

  expect(result.events).toHaveLength(2);
  expect(result.events.every((e) => e.type === 'daemon.ping')).toBe(true);
});
