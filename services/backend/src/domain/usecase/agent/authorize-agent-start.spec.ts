import { describe, expect, test } from 'vitest';

import { authorizeAgentStart } from './authorize-agent-start';
import { api } from '../../../../convex/_generated/api';
import { t } from '../../../../test.setup';
import { AgentStartReasonCode } from '../../entities/agent';

async function setup(id: string) {
  await t.mutation(api.auth.loginAnon, { sessionId: id as any });
  const chatroomId = await t.mutation(api.chatrooms.create, {
    sessionId: id as any,
    teamId: 'duo',
    teamName: 'Duo',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
  const machineId = `authorize-${id}`;
  await t.mutation(api.machines.register, {
    sessionId: id as any,
    machineId,
    hostname: 'test',
    os: 'linux',
    availableHarnesses: ['opencode'],
  });
  await t.mutation(api.machines.sendCommand, {
    sessionId: id as any,
    machineId,
    type: 'start-agent',
    payload: {
      chatroomId,
      role: 'builder',
      model: 'test-model',
      agentHarness: 'opencode',
      workingDir: '/workspace',
    },
  });
  return { chatroomId, machineId };
}

describe('authorizeAgentStart', () => {
  test('allows a submitted launch and rejects a different machine', async () => {
    const { chatroomId, machineId } = await setup('authorize-cases');
    expect(
      await t.run((ctx) => authorizeAgentStart(ctx, { chatroomId, role: 'builder', machineId }))
    ).toEqual({ allowed: true });
    expect(
      (
        await t.run((ctx) =>
          authorizeAgentStart(ctx, { chatroomId, role: 'builder', machineId: 'wrong' })
        )
      ).reason
    ).toBe('not_configured');
  });

  test('requires an active task for ephemeral architect starts', async () => {
    const { chatroomId, machineId } = await setup('authorize-ephemeral');
    const room = await t.run((ctx) => ctx.db.get('chatroom_rooms', chatroomId));
    const architectId = await t.run(async (ctx) =>
      ctx.db.insert('chatroom_agentLastSentLaunchRequests', {
        requestKey: `${chatroomId}:duo@1:architect`,
        requestId: 'architect-request',
        commandId: 'architect-command',
        teamStructureId: 'duo@1',
        chatroomId,
        role: 'architect',
        agentType: 'remote',
        machineId,
        agentHarness: 'opencode',
        model: 'test',
        workingDir: '/workspace',
        reason: AgentStartReasonCode.USER_START,
        wantResume: false,
        requestedBy: room!.ownerId,
        requestedAt: Date.now(),
      })
    );
    expect(architectId).toBeDefined();
    expect(
      await t.run((ctx) => authorizeAgentStart(ctx, { chatroomId, role: 'architect', machineId }))
    ).toEqual({ allowed: false, reason: 'no_active_task' });
    const taskId = await t.run((ctx) =>
      ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'Enhance',
        status: 'pending',
        assignedTo: 'architect',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        queuePosition: 1,
      })
    );
    expect(
      await t.run((ctx) =>
        authorizeAgentStart(ctx, { chatroomId, role: 'architect', machineId, taskId })
      )
    ).toEqual({ allowed: true });
    await t.run((ctx) => ctx.db.patch('chatroom_tasks', taskId, { status: 'completed' }));
    expect(
      await t.run((ctx) =>
        authorizeAgentStart(ctx, { chatroomId, role: 'architect', machineId, taskId })
      )
    ).toEqual({ allowed: false, reason: 'no_active_task' });
  });
});
