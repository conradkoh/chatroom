/**
 * Stop Agent — Integration Tests
 *
 * Tests the `stopAgent` use case which enqueues scoped stop commands
 * on the dedicated agent command inbox.
 */

import { describe, expect, test } from 'vitest';

import { stopAgent } from '../../src/domain/usecase/agent/stop-agent';
import { t } from '../../test.setup';
import {
  createBuilderEntryDuoChatroom,
  createTestSession,
  registerMachineWithDaemon,
  seedRunningAgentPid,
  setupRemoteAgentConfig,
} from '../helpers/integration';
/** Dedicated pending agent.stop rows for a machine. */
async function getAgentCommandInboxForMachine(machineId: string) {
  return t.run(async (ctx) =>
    ctx.db
      .query('chatroom_agentCommandInbox')
      .withIndex('by_machine_status_deadline', (q) =>
        q.eq('machineId', machineId).eq('status', 'pending')
      )
      .collect()
  );
}

describe('stopAgent', () => {
  test('enqueues dedicated agent.stop when a team config exists', async () => {
    const { sessionId } = await createTestSession('test-stop-1');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'machine-stop-1';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');
    await seedRunningAgentPid(sessionId, chatroomId, machineId, 'builder', 91001);

    await t.run(async (ctx) => {
      const user = await ctx.db.query('users').first();
      return stopAgent(ctx, {
        machineId,
        chatroomId,
        role: 'builder',
        userId: user!._id,
        reason: 'test',
      });
    });

    const inbox = await getAgentCommandInboxForMachine(machineId);
    const stopCmd = inbox.find((row) => row.command.type === 'agent.stop');
    expect(stopCmd).toBeDefined();
    if (stopCmd?.command.type === 'agent.stop') {
      expect(stopCmd.command.chatroomId).toBe(chatroomId);
      expect(stopCmd.command.reason).toBe('test');
    }
  });

  test('returns empty result (no legacy command ID)', async () => {
    const { sessionId } = await createTestSession('test-stop-2');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'machine-stop-2';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    const result = await t.run(async (ctx) => {
      const user = await ctx.db.query('users').first();
      return stopAgent(ctx, {
        machineId,
        chatroomId,
        role: 'planner',
        userId: user!._id,
        reason: 'test',
      });
    });

    expect(result).toBeDefined();
    expect((result as { commandId?: unknown | undefined }).commandId).toBeUndefined();
  });

  test('multiple scoped stop commands can be enqueued independently', async () => {
    const { sessionId } = await createTestSession('test-stop-3');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'machine-stop-3';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'planner');
    await seedRunningAgentPid(sessionId, chatroomId, machineId, 'builder', 91002);
    await seedRunningAgentPid(sessionId, chatroomId, machineId, 'planner', 91003);

    await t.run(async (ctx) => {
      const user = await ctx.db.query('users').first();
      await stopAgent(ctx, {
        machineId,
        chatroomId,
        role: 'builder',
        userId: user!._id,
        reason: 'test',
      });
      await stopAgent(ctx, {
        machineId,
        chatroomId,
        role: 'planner',
        userId: user!._id,
        reason: 'test',
      });
    });

    const inbox = await getAgentCommandInboxForMachine(machineId);
    expect(inbox.length).toBe(1);
    const configs = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect()
    );
    expect(
      configs
        .filter((c) => c.role === 'builder' || c.role === 'planner')
        .every((c) => c.desiredState === 'stopped')
    ).toBe(true);
  });
});
