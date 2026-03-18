/**
 * Agent Auto-Restart Integration Tests
 *
 * Verifies that the `onAgentExited` handler correctly emits (or skips)
 * agent.requestStart based on the `stopReason` and `desiredState` values.
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
  setupRemoteAgentConfig,
} from '../helpers/integration';
import { buildTeamRoleKey } from '../../convex/utils/teamRoleKey';

// ---------------------------------------------------------------------------
// Helper: find an agent.requestStart event with crash_recovery reason
// ---------------------------------------------------------------------------

async function findCrashRecoveryEvent(chatroomId: string) {
  const events = await t.run(async (ctx) => {
    return ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
  });
  return events.find(
    (e) =>
      e.type === 'agent.requestStart' &&
      (e as { reason?: string }).reason === 'platform.crash_recovery'
  );
}

// ---------------------------------------------------------------------------
// Test A: stopReason=agent_process.crashed → emits agent.requestStart
// ---------------------------------------------------------------------------

test('recordAgentExited with stopReason=agent_process.crashed emits agent.requestStart', async () => {
  // SETUP
  const { sessionId } = await createTestSession('test-ar-a');
  const chatroomId = await createPairTeamChatroom(sessionId);
  const machineId = 'machine-ar-a';
  await registerMachineWithDaemon(sessionId, machineId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

  // Set desiredState=running so crash recovery can trigger
  await t.run(async (ctx) => {
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'pair', 'builder'))
      )
      .first();
    if (config) await ctx.db.patch(config._id, { desiredState: 'running' });
  });

  // ACTION — stopReason=agent_process.crashed triggers crash recovery
  await t.mutation(api.machines.recordAgentExited, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder',
    pid: 12345,
    stopReason: 'agent_process.crashed',
  });

  // VERIFY — agent.requestStart IS emitted with crash_recovery reason
  const crashRecoveryEvent = await findCrashRecoveryEvent(chatroomId);
  expect(crashRecoveryEvent, 'agent.requestStart should be emitted when stopReason=agent_process.crashed').toBeDefined();
});

// ---------------------------------------------------------------------------
// Test B: stopReason=agent_process.exited_clean → emits agent.requestStart
// ---------------------------------------------------------------------------

test('recordAgentExited with stopReason=agent_process.exited_clean emits agent.requestStart', async () => {
  // SETUP
  const { sessionId } = await createTestSession('test-ar-b');
  const chatroomId = await createPairTeamChatroom(sessionId);
  const machineId = 'machine-ar-b';
  await registerMachineWithDaemon(sessionId, machineId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

  // Set desiredState=running so crash recovery can trigger
  await t.run(async (ctx) => {
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'pair', 'builder'))
      )
      .first();
    if (config) await ctx.db.patch(config._id, { desiredState: 'running' });
  });

  // ACTION
  await t.mutation(api.machines.recordAgentExited, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder',
    pid: 12346,
    stopReason: 'agent_process.exited_clean',
  });

  // VERIFY — agent.requestStart IS emitted
  const crashRecoveryEvent = await findCrashRecoveryEvent(chatroomId);
  expect(crashRecoveryEvent, 'agent.requestStart should be emitted when stopReason=agent_process.exited_clean').toBeDefined();
});

// ---------------------------------------------------------------------------
// Test C: desiredState=stopped → does NOT emit agent.requestStart even if stopReason says restart
// ---------------------------------------------------------------------------

test('recordAgentExited with desiredState=stopped does NOT emit agent.requestStart even when stopReason=agent_process.crashed', async () => {
  // SETUP
  const { sessionId } = await createTestSession('test-ar-c');
  const chatroomId = await createPairTeamChatroom(sessionId);
  const machineId = 'machine-ar-c';
  await registerMachineWithDaemon(sessionId, machineId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

  // Set desiredState='stopped' for the builder role (user explicitly stopped the agent)
  await t.run(async (ctx) => {
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'pair', 'builder'))
      )
      .first();
    if (config) await ctx.db.patch(config._id, { desiredState: 'stopped' });
  });

  // ACTION — stopReason would normally trigger restart, but desiredState='stopped' overrides
  await t.mutation(api.machines.recordAgentExited, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder',
    pid: 12347,
    stopReason: 'agent_process.crashed',
  });

  // VERIFY — NO agent.requestStart emitted (user intent respected)
  const crashRecoveryEvent = await findCrashRecoveryEvent(chatroomId);
  expect(crashRecoveryEvent, 'agent.requestStart should NOT be emitted when desiredState=stopped').toBeUndefined();
});
