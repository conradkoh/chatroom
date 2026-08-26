import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import {
  createBuilderEntryDuoChatroom,
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
  updateSpawnedAgentInTest,
} from '../helpers/integration';
import { getInboxCommandsForMachine } from '../helpers/machine-command-inbox';

describe('agent stop request reason', () => {
  test('defaults to user.stop', async () => {
    const { sessionId } = await createTestSession('stop-reason-default');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'stop-reason-default-machine';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');
    await updateSpawnedAgentInTest(sessionId, machineId, chatroomId, 'builder', 50101);
    await t.mutation(api.agentStops.request, { sessionId, chatroomId, machineId, role: 'builder' });
    const inbox = await getInboxCommandsForMachine(machineId, 'agent.stopScope');
    const row = inbox.find((item) => item.command.type === 'agent.stopScope');
    expect(row).toBeDefined();
    const command =
      row && row.command.type === 'agent.stopScope'
        ? await t.run((ctx) => ctx.db.get('chatroom_agentStopCommands', row.command.stopCommandId))
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
    const inbox = await getInboxCommandsForMachine(machineId, 'agent.stopScope');
    const row = inbox.find((item) => item.command.type === 'agent.stopScope');
    expect(row).toBeDefined();
    const command =
      row && row.command.type === 'agent.stopScope'
        ? await t.run((ctx) => ctx.db.get('chatroom_agentStopCommands', row.command.stopCommandId))
        : null;
    expect(command?.reason).toBe('platform.dedup');
  });
});
