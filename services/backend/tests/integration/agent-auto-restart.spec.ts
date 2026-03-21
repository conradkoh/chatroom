/**
 * Agent Exit Integration Tests
 *
 * Verifies that `recordAgentExited` correctly handles cleanup
 * (PID clearing, event recording) regardless of stopReason.
 *
 * Crash recovery is now fully owned by the daemon — the backend
 * no longer emits `agent.requestStart` on exit. These tests confirm:
 * 1. agent.exited event is always recorded
 * 2. NO agent.requestStart is emitted (daemon owns restarts)
 * 3. spawnedAgentPid is cleared after exit
 */

import { expect, test } from 'vitest';

import type { Id } from '../../convex/_generated/dataModel';
import { api } from '../../convex/_generated/api';
import { buildTeamRoleKey } from '../../convex/utils/teamRoleKey';
import { t } from '../../test.setup';
import {
  createPairTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../helpers/integration';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findRequestStartEvent(chatroomId: Id<'chatroom_rooms'>) {
  const events = await t.run(async (ctx) => {
    return ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
  });
  // Only look for crash-recovery requestStart events — the setup helper emits
  // a user.start event that should not count as a daemon-triggered restart.
  return events.find(
    (e) =>
      e.type === 'agent.requestStart' &&
      (e as { reason?: string }).reason === 'platform.crash_recovery'
  );
}

async function findExitedEvent(chatroomId: Id<'chatroom_rooms'>) {
  const events = await t.run(async (ctx) => {
    return ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
  });
  return events.find((e) => e.type === 'agent.exited');
}

// ---------------------------------------------------------------------------
// Tests — daemon owns restarts, backend only records exit
// ---------------------------------------------------------------------------

test('recordAgentExited records agent.exited event and does NOT emit agent.requestStart (crashed)', async () => {
  const { sessionId } = await createTestSession('test-ar-a');
  const chatroomId = await createPairTeamChatroom(sessionId);
  const machineId = 'machine-ar-a';
  await registerMachineWithDaemon(sessionId, machineId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

  await t.run(async (ctx) => {
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'pair', 'builder'))
      )
      .first();
    if (config) await ctx.db.patch(config._id, { desiredState: 'running' });
  });

  await t.mutation(api.machines.recordAgentExited, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder',
    pid: 12345,
    stopReason: 'agent_process.crashed',
  });

  const exitedEvent = await findExitedEvent(chatroomId);
  expect(exitedEvent, 'agent.exited should be recorded').toBeDefined();

  const requestStartEvent = await findRequestStartEvent(chatroomId);
  expect(
    requestStartEvent,
    'agent.requestStart should NOT be emitted — daemon owns restarts'
  ).toBeUndefined();
});

test('recordAgentExited records agent.exited event and does NOT emit agent.requestStart (exited_clean)', async () => {
  const { sessionId } = await createTestSession('test-ar-b');
  const chatroomId = await createPairTeamChatroom(sessionId);
  const machineId = 'machine-ar-b';
  await registerMachineWithDaemon(sessionId, machineId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

  await t.run(async (ctx) => {
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'pair', 'builder'))
      )
      .first();
    if (config) await ctx.db.patch(config._id, { desiredState: 'running' });
  });

  await t.mutation(api.machines.recordAgentExited, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder',
    pid: 12346,
    stopReason: 'agent_process.exited_clean',
  });

  const exitedEvent = await findExitedEvent(chatroomId);
  expect(exitedEvent, 'agent.exited should be recorded').toBeDefined();

  const requestStartEvent = await findRequestStartEvent(chatroomId);
  expect(
    requestStartEvent,
    'agent.requestStart should NOT be emitted — daemon owns restarts'
  ).toBeUndefined();
});

test('recordAgentExited clears spawnedAgentPid after exit', async () => {
  const { sessionId } = await createTestSession('test-ar-c');
  const chatroomId = await createPairTeamChatroom(sessionId);
  const machineId = 'machine-ar-c';
  await registerMachineWithDaemon(sessionId, machineId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

  await t.mutation(api.machines.recordAgentExited, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder',
    pid: 12347,
    stopReason: 'user.stop',
  });

  const config = await t.run(async (ctx) => {
    return ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'pair', 'builder'))
      )
      .first();
  });

  expect(config?.spawnedAgentPid, 'spawnedAgentPid should be cleared after exit').toBeUndefined();
});
