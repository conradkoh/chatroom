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

import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { t } from '../test.setup';

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
    teamId: 'pair',
    teamName: 'Pair Team',
    teamRoles: ['builder', 'reviewer'],
    teamEntryPoint: 'builder',
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
): Promise<Id<'chatroom_eventStream'>> {
  return await t.run(async (ctx) => {
    if (type === 'agent.requestStart') {
      return await ctx.db.insert('chatroom_eventStream', {
        type: 'agent.requestStart',
        chatroomId,
        machineId,
        role: 'builder',
        agentHarness: 'opencode',
        model: 'anthropic/claude-sonnet-4',
        workingDir: '/tmp/test',
        reason: 'test',
        deadline: Date.now() + 120_000,
        timestamp: Date.now(),
      });
    } else {
      return await ctx.db.insert('chatroom_eventStream', {
        type: 'agent.requestStop',
        chatroomId,
        machineId,
        role: 'builder',
        reason: 'test',
        deadline: Date.now() + 120_000,
        timestamp: Date.now(),
      });
    }
  });
}

async function insertNonCommandEvent(
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string
): Promise<Id<'chatroom_eventStream'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('chatroom_eventStream', {
      type: 'agent.started',
      chatroomId,
      machineId,
      role: 'builder',
      agentHarness: 'opencode',
      model: 'anthropic/claude-sonnet-4',
      workingDir: '/tmp/test',
      pid: 1234,
      timestamp: Date.now(),
    });
  });
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

// Test 5: Type filter — non-command events are NOT returned
test('getCommandEvents — filters out non-command events (agent.started, task.activated)', async () => {
  const { sessionId } = await createTestSession('gce-5');
  const chatroomId = await createChatroom(sessionId);
  const machineId = 'machine-gce-5';
  await registerMachine(sessionId, machineId);

  // Insert a non-command event for the same machine
  await insertNonCommandEvent(chatroomId, machineId);

  const result = await t.query(api.machines.getCommandEvents, {
    sessionId,
    machineId,
  });

  expect(result.events).toHaveLength(0);
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

  // Insert an event with an expired deadline
  await t.run(async (ctx) => {
    await ctx.db.insert('chatroom_eventStream', {
      type: 'agent.requestStop',
      chatroomId,
      machineId,
      role: 'builder',
      reason: 'test',
      deadline: Date.now() - 1000, // expired 1 second ago
      timestamp: Date.now() - 200_000,
    });
  });

  const result = await t.query(api.machines.getCommandEvents, {
    sessionId,
    machineId,
  });

  expect(result.events).toHaveLength(0);
});

// Test 9: daemon.ping events are returned without cursor filtering
test('getCommandEvents — all daemon.ping events are returned (no cursor filter)', async () => {
  const { sessionId } = await createTestSession('gce-9');
  const machineId = 'machine-gce-9';
  await registerMachine(sessionId, machineId);

  // Insert two ping events
  await t.run(async (ctx) => {
    await ctx.db.insert('chatroom_eventStream', {
      type: 'daemon.ping',
      machineId,
      timestamp: Date.now(),
    });
    await ctx.db.insert('chatroom_eventStream', {
      type: 'daemon.ping',
      machineId,
      timestamp: Date.now(),
    });
  });

  // Both pings should be returned — no cursor filtering
  const result = await t.query(api.machines.getCommandEvents, {
    sessionId,
    machineId,
  });

  expect(result.events).toHaveLength(2);
  expect(result.events.every((e) => e.type === 'daemon.ping')).toBe(true);
});
