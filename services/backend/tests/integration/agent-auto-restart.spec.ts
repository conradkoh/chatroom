/**
 * Agent Auto-Restart Integration Tests
 *
 * Verifies that the `onAgentExitedEvent` handler correctly schedules (or skips)
 * ensure-agent based on the `stopReason` and `desiredState` values.
 *
 * Tests A, B, C cover the stopReason-based restart logic documented in
 * `src/events/agent/on-agent-exited.ts`.
 */

import { expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import {
  createPairTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
} from '../helpers/integration';

// ---------------------------------------------------------------------------
// Helper: find an ensure-agent scheduled function for a chatroom
// ---------------------------------------------------------------------------

async function findEnsureAgentCheck(chatroomId: string) {
  const scheduled = await t.run(async (ctx) => {
    return ctx.db.system.query('_scheduled_functions').collect();
  });
  return scheduled.find((s) => {
    const argsArray = (s as { args?: unknown[] }).args;
    const checkArgs = argsArray?.[0] as { snapshotUpdatedAt?: number; chatroomId?: string } | undefined;
    return checkArgs?.snapshotUpdatedAt === 0 && checkArgs?.chatroomId === chatroomId;
  });
}

// ---------------------------------------------------------------------------
// Test A: stopReason=process_terminated_unexpectedly → schedules ensure-agent
// ---------------------------------------------------------------------------

test('recordAgentExited with stopReason=process_terminated_unexpectedly schedules ensure-agent', async () => {
  // SETUP
  const { sessionId } = await createTestSession('test-ar-a');
  const chatroomId = await createPairTeamChatroom(sessionId);
  const machineId = 'machine-ar-a';
  await registerMachineWithDaemon(sessionId, machineId);

  // Create an active task
  await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    content: 'task for auto-restart test A',
    senderRole: 'user',
    type: 'message',
  });

  // ACTION — intentional=true BUT stopReason overrides it
  await t.mutation(api.machines.recordAgentExited, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder',
    pid: 12345,
    intentional: true,
    stopReason: 'process_terminated_unexpectedly',
  });

  // VERIFY — ensure-agent IS scheduled (stopReason overrides intentional flag)
  const ensureCheck = await findEnsureAgentCheck(chatroomId);
  expect(ensureCheck, 'ensure-agent should be scheduled when stopReason=process_terminated_unexpectedly').toBeDefined();
});

// ---------------------------------------------------------------------------
// Test B: stopReason=process_exited_with_success → schedules ensure-agent
// ---------------------------------------------------------------------------

test('recordAgentExited with stopReason=process_exited_with_success schedules ensure-agent', async () => {
  // SETUP
  const { sessionId } = await createTestSession('test-ar-b');
  const chatroomId = await createPairTeamChatroom(sessionId);
  const machineId = 'machine-ar-b';
  await registerMachineWithDaemon(sessionId, machineId);

  // Create an active task
  await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    content: 'task for auto-restart test B',
    senderRole: 'user',
    type: 'message',
  });

  // ACTION
  await t.mutation(api.machines.recordAgentExited, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder',
    pid: 12346,
    intentional: false,
    stopReason: 'process_exited_with_success',
  });

  // VERIFY — ensure-agent IS scheduled
  const ensureCheck = await findEnsureAgentCheck(chatroomId);
  expect(ensureCheck, 'ensure-agent should be scheduled when stopReason=process_exited_with_success').toBeDefined();
});

// ---------------------------------------------------------------------------
// Test C: desiredState=stopped → does NOT schedule ensure-agent even if stopReason says restart
// ---------------------------------------------------------------------------

test('recordAgentExited with desiredState=stopped does NOT schedule ensure-agent even when stopReason=process_terminated_unexpectedly', async () => {
  // SETUP
  const { sessionId } = await createTestSession('test-ar-c');
  const chatroomId = await createPairTeamChatroom(sessionId);
  const machineId = 'machine-ar-c';
  await registerMachineWithDaemon(sessionId, machineId);

  // Create an active task
  await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    content: 'task for auto-restart test C',
    senderRole: 'user',
    type: 'message',
  });

  // Set desiredState='stopped' for the builder role (user explicitly stopped the agent)
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert('chatroom_teamAgentConfigs', {
      teamRoleKey: `chatroom_${chatroomId}#role_builder`,
      chatroomId,
      role: 'builder',
      type: 'remote',
      desiredState: 'stopped',
      createdAt: now,
      updatedAt: now,
    });
  });

  // ACTION — stopReason would normally trigger restart, but desiredState='stopped' overrides
  await t.mutation(api.machines.recordAgentExited, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder',
    pid: 12347,
    intentional: false,
    stopReason: 'process_terminated_unexpectedly',
  });

  // VERIFY — NO ensure-agent scheduled (user intent respected)
  const ensureCheck = await findEnsureAgentCheck(chatroomId);
  expect(ensureCheck, 'ensure-agent should NOT be scheduled when desiredState=stopped').toBeUndefined();
});
