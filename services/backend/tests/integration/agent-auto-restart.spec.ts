/**
 * Agent Auto-Restart Integration Tests
 *
 * Verifies that the `onAgentExitedEvent` handler correctly emits (or skips)
 * agent.requestStart events based on the `stopReason` and `desiredState` values.
 *
 * Tests A, B, C cover the stopReason-based restart logic documented in
 * `src/events/agent/on-agent-exited.ts`.
 */

import { expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  createPairTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../helpers/integration';
import { buildTeamRoleKey } from '../../convex/utils/teamRoleKey';

// ---------------------------------------------------------------------------
// Helper: count agent.requestStart events for a chatroom
// ---------------------------------------------------------------------------

async function countRequestStartEvents(chatroomId: Id<'chatroom_rooms'>) {
  return await t.run(async (ctx) => {
    const events = await ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroom_type', (q) =>
        q.eq('chatroomId', chatroomId).eq('type', 'agent.requestStart')
      )
      .collect();
    return events.length;
  });
}

// ---------------------------------------------------------------------------
// Test A: stopReason=agent_process.crashed → emits agent.requestStart
// ---------------------------------------------------------------------------

test('recordAgentExited with stopReason=agent_process.crashed emits agent.requestStart', async () => {
  const { sessionId } = await createTestSession('test-ar-a');
  const chatroomId = await createPairTeamChatroom(sessionId);
  const machineId = 'machine-ar-a';
  await registerMachineWithDaemon(sessionId, machineId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

  // Create an active task
  await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    content: 'task for auto-restart test A',
    senderRole: 'user',
    type: 'message',
  });

  // Snapshot AFTER task creation (sendMessage fires emitRequestStartIfNeeded)
  const startsBefore = await countRequestStartEvents(chatroomId);

  // ACTION — intentional=true BUT stopReason overrides it
  await t.mutation(api.machines.recordAgentExited, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder',
    pid: 12345,
    intentional: true,
    stopReason: 'agent_process.crashed',
  });

  // VERIFY — agent.requestStart event emitted by onAgentExited
  const startsAfter = await countRequestStartEvents(chatroomId);
  expect(startsAfter).toBeGreaterThan(startsBefore);
});

// ---------------------------------------------------------------------------
// Test B: stopReason=agent_process.exited_clean → emits agent.requestStart
// ---------------------------------------------------------------------------

test('recordAgentExited with stopReason=agent_process.exited_clean emits agent.requestStart', async () => {
  const { sessionId } = await createTestSession('test-ar-b');
  const chatroomId = await createPairTeamChatroom(sessionId);
  const machineId = 'machine-ar-b';
  await registerMachineWithDaemon(sessionId, machineId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

  // Create an active task
  await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    content: 'task for auto-restart test B',
    senderRole: 'user',
    type: 'message',
  });

  // Snapshot AFTER task creation
  const startsBefore = await countRequestStartEvents(chatroomId);

  // ACTION
  await t.mutation(api.machines.recordAgentExited, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder',
    pid: 12346,
    intentional: false,
    stopReason: 'agent_process.exited_clean',
  });

  // VERIFY — agent.requestStart event emitted
  const startsAfter = await countRequestStartEvents(chatroomId);
  expect(startsAfter).toBeGreaterThan(startsBefore);
});

// ---------------------------------------------------------------------------
// Test C: desiredState=stopped → does NOT emit agent.requestStart
// ---------------------------------------------------------------------------

test('recordAgentExited with desiredState=stopped does NOT emit agent.requestStart even when stopReason=agent_process.crashed', async () => {
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
      teamRoleKey: buildTeamRoleKey(chatroomId, 'pair', 'builder'),
      chatroomId,
      role: 'builder',
      type: 'remote',
      machineId,
      agentHarness: 'opencode',
      model: 'anthropic/claude-sonnet-4',
      workingDir: '/tmp/test',
      desiredState: 'stopped',
      createdAt: now,
      updatedAt: now,
    });
  });

  // Snapshot AFTER task creation and config setup
  const startsBefore = await countRequestStartEvents(chatroomId);

  // ACTION — stopReason would normally trigger restart, but desiredState='stopped' overrides
  await t.mutation(api.machines.recordAgentExited, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder',
    pid: 12347,
    intentional: false,
    stopReason: 'agent_process.crashed',
  });

  // VERIFY — NO new agent.requestStart events (user intent respected)
  const startsAfter = await countRequestStartEvents(chatroomId);
  expect(startsAfter).toBe(startsBefore);
});
