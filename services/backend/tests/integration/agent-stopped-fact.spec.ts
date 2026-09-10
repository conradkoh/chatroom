import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import {
  createBuilderEntryDuoChatroom,
  createTestSession,
  registerMachineWithDaemon,
  seedRunningAgentPid,
  setupRemoteAgentConfig,
} from '../helpers/integration';

describe('agentStops.reportAgentStoppedFact', () => {
  test('dedicated stop request projects via stable intentId; duplicate is harmless', async () => {
    const { sessionId } = await createTestSession('fact-e2e-1');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'fact-e2e-machine-1';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');
    await seedRunningAgentPid(sessionId, chatroomId, machineId, 'builder', 9601);

    const requested = await t.mutation(api.agentStops.requestAgent, {
      sessionId,
      chatroomId,
      machineId,
      role: 'builder',
      reason: 'user.stop',
    });
    const stopCommandId = requested.stopCommandId;

    const fact = {
      eventId: 'agent.stopped:inbox-1:builder',
      intentId: String(stopCommandId),
      commandId: 'inbox-1',
      machineId,
      chatroomId,
      role: 'builder',
      pid: 9601,
      outcome: 'stopped' as const,
      reason: 'user.stop' as const,
      occurredAt: Date.now(),
    };
    const first = await t.mutation(api.agentStops.reportAgentStoppedFact, {
      sessionId,
      machineId,
      fact,
    });
    expect(first).toEqual({ success: true, applied: true });

    const duplicate = await t.mutation(api.agentStops.reportAgentStoppedFact, {
      sessionId,
      machineId,
      fact,
    });
    expect(duplicate).toEqual({ success: true, applied: false });

    const command = await t.run((ctx) => ctx.db.get('chatroom_agentStopCommands', stopCommandId));
    expect(command?.status).toBe('completed');
    const targets = await t.run((ctx) =>
      ctx.db
        .query('chatroom_agentStopTargets')
        .withIndex('by_stopCommandId', (q) => q.eq('stopCommandId', stopCommandId))
        .collect()
    );
    expect(targets).toHaveLength(1);
    expect(targets[0]?.status).toBe('completed');
    expect(targets[0]?.outcome).toBe('stopped');
    const executions = await t.run((ctx) =>
      ctx.db
        .query('chatroom_agentStopMachineExecutions')
        .withIndex('by_stopCommandId', (q) => q.eq('stopCommandId', stopCommandId))
        .collect()
    );
    expect(executions.every((e) => e.status === 'completed')).toBe(true);
  });

  test('unauthorized machine is rejected', async () => {
    const { sessionId } = await createTestSession('fact-e2e-2');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'fact-e2e-machine-2';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');
    await seedRunningAgentPid(sessionId, chatroomId, machineId, 'builder', 9602);
    const requested = await t.mutation(api.agentStops.requestAgent, {
      sessionId,
      chatroomId,
      machineId,
      role: 'builder',
      reason: 'user.stop',
    });
    const stranger = `fact-e2e-stranger-${Date.now()}` as SessionId;
    await t.mutation(api.auth.loginAnon, { sessionId: stranger });
    await expect(
      t.mutation(api.agentStops.reportAgentStoppedFact, {
        sessionId: stranger,
        machineId,
        fact: {
          eventId: 'e',
          intentId: String(requested.stopCommandId),
          commandId: 'inbox-x',
          machineId,
          chatroomId,
          role: 'builder',
          pid: 9602,
          outcome: 'stopped' as const,
          reason: 'user.stop' as const,
          occurredAt: Date.now(),
        },
      })
    ).rejects.toThrow('NOT_AUTHORIZED_MACHINE');
  });

  test('mismatched fact is a no-op', async () => {
    const { sessionId } = await createTestSession('fact-e2e-3');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'fact-e2e-machine-3';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');
    await seedRunningAgentPid(sessionId, chatroomId, machineId, 'builder', 9603);
    const requested = await t.mutation(api.agentStops.requestAgent, {
      sessionId,
      chatroomId,
      machineId,
      role: 'builder',
      reason: 'user.stop',
    });
    const result = await t.mutation(api.agentStops.reportAgentStoppedFact, {
      sessionId,
      machineId,
      fact: {
        eventId: 'e',
        intentId: String(requested.stopCommandId),
        commandId: 'inbox-y',
        machineId,
        chatroomId,
        role: 'builder',
        pid: 9999,
        outcome: 'stopped' as const,
        reason: 'user.stop' as const,
        occurredAt: Date.now(),
      },
    });
    expect(result).toEqual({ success: true, applied: false });
  });
});
