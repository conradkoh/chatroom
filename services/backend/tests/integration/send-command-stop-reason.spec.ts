import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  createBuilderEntryDuoChatroom,
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
  updateSpawnedAgentInTest,
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

describe('agent stop request reason', () => {
  test('defaults to user.stop', async () => {
    const { sessionId } = await createTestSession('stop-reason-default');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'stop-reason-default-machine';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');
    await updateSpawnedAgentInTest(sessionId, machineId, chatroomId, 'builder', 50101);
    await t.mutation(api.agentStops.request, { sessionId, chatroomId, machineId, role: 'builder' });
    const inbox = await getAgentCommandInboxForMachine(machineId);
    const row = inbox.find((item) => item.command.type === 'agent.stop');
    expect(row).toBeDefined();
    expect(row?.command.reason).toBe('user.stop');
    const command = row
      ? await t.run((ctx) =>
          ctx.db.get(
            'chatroom_agentStopCommands',
            row.command.intentId as Id<'chatroom_agentStopCommands'>
          )
        )
      : null;
    expect(command?.reason).toBe('user.stop');
  });

  test('preserves explicit platform reason', async () => {
    const { sessionId } = await createTestSession('stop-reason-explicit');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'stop-reason-explicit-machine';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');
    await updateSpawnedAgentInTest(sessionId, machineId, chatroomId, 'builder', 50102);
    await t.mutation(api.agentStops.request, {
      sessionId,
      chatroomId,
      machineId,
      role: 'builder',
      reason: 'platform.dedup',
    });
    const inbox = await getAgentCommandInboxForMachine(machineId);
    const row = inbox.find((item) => item.command.type === 'agent.stop');
    expect(row).toBeDefined();
    expect(row?.command.reason).toBe('platform.dedup');
    const command = row
      ? await t.run((ctx) =>
          ctx.db.get(
            'chatroom_agentStopCommands',
            row.command.intentId as Id<'chatroom_agentStopCommands'>
          )
        )
      : null;
    expect(command?.reason).toBe('platform.dedup');
  });
});
