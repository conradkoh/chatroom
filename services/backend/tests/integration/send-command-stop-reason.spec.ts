import { describe, expect, test } from 'vitest';
import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { getInboxCommandsForMachine } from '../helpers/machine-command-inbox';
import { createBuilderEntryDuoChatroom, createTestSession, registerMachineWithDaemon, setupRemoteAgentConfig } from '../helpers/integration';

describe('agent stop request reason', () => {
  test('defaults to user.stop', async () => {
    const { sessionId } = await createTestSession('stop-reason-default');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'stop-reason-default-machine';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');
    await t.mutation(api.machines.updateSpawnedAgent, { sessionId, machineId, chatroomId, role: 'builder', pid: 50101 });
    await t.mutation(api.agentStops.request, { sessionId, chatroomId, machineId, role: 'builder' });
    const inbox = await getInboxCommandsForMachine(machineId, 'agent.stopScope');
    const row = inbox.find((item) => item.command.type === 'agent.stopScope');
    expect(row).toBeDefined();
    const command = row && row.command.type === 'agent.stopScope' ? await t.run((ctx) => ctx.db.get('chatroom_agentStopCommands', row.command.stopCommandId)) : null;
    expect(command?.reason).toBe('user.stop');
  });

  test('preserves explicit platform reason', async () => {
    const { sessionId } = await createTestSession('stop-reason-explicit');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'stop-reason-explicit-machine';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');
    await t.mutation(api.machines.updateSpawnedAgent, { sessionId, machineId, chatroomId, role: 'builder', pid: 50102 });
    await t.mutation(api.agentStops.request, { sessionId, chatroomId, machineId, role: 'builder', reason: 'platform.dedup' });
    const inbox = await getInboxCommandsForMachine(machineId, 'agent.stopScope');
    const row = inbox.find((item) => item.command.type === 'agent.stopScope');
    expect(row).toBeDefined();
    const command = row && row.command.type === 'agent.stopScope' ? await t.run((ctx) => ctx.db.get('chatroom_agentStopCommands', row.command.stopCommandId)) : null;
    expect(command?.reason).toBe('platform.dedup');
  });
});
