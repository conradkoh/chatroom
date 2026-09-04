import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { buildTeamRoleKey } from '../../convex/utils/teamRoleKey';
import { authorizeAgentStart } from '../../src/domain/usecase/agent/authorize-agent-start';
import { startAgent } from '../../src/domain/usecase/agent/start-agent';
import { transitionTask } from '../../src/domain/usecase/task/transition-task';
import { t } from '../../test.setup';
import {
  createPlannerBuilderDuoChatroom,
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../helpers/integration';

async function builderConfigFor(chatroomId: any) {
  return t.run((ctx) =>
    ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
      )
      .first()
  );
}

describe('builder ephemeral lifecycle', () => {
  test('planner handoff arms the builder config and creates a builder task', async () => {
    const { sessionId } = await createTestSession('builder-lifecycle-handoff');
    const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    const machineId = 'machine-builder-lifecycle-handoff';
    await registerMachineWithDaemon(sessionId, machineId);
    await t.mutation(api.workspaces.registerWorkspace, {
      sessionId,
      chatroomId,
      machineId,
      workingDir: '/workspace',
      hostname: 'test-host',
      registeredBy: 'planner',
    });
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'planner');

    expect(await builderConfigFor(chatroomId)).toBeNull();

    const handoff = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'builder',
      content: 'Build me a feature',
    });
    expect(handoff.success).toBe(true);

    const task = await t.run((ctx) => ctx.db.get('chatroom_tasks', handoff.newTaskId));
    expect(task?.assignedTo).toBe('builder');

    const config = await builderConfigFor(chatroomId);
    expect(config?.type).toBe('remote');
    expect(config?.enabled).toBe(true);
    expect(config?.desiredState).toBe('running');
    expect(config?.machineId).toBe(machineId);
    expect(config?.spawnedAgentPid).toBeUndefined();
  });

  test('authorizeAgentStart requires an active task for the ephemeral builder', async () => {
    const { sessionId } = await createTestSession('builder-lifecycle-auth');
    const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    const machineId = 'machine-builder-lifecycle-auth';
    await registerMachineWithDaemon(sessionId, machineId);
    await t.mutation(api.workspaces.registerWorkspace, {
      sessionId,
      chatroomId,
      machineId,
      workingDir: '/workspace',
      hostname: 'test-host',
      registeredBy: 'planner',
    });
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'planner');
    await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'builder',
      content: 'Auth check task',
    });

    const user = await t.run((ctx) => ctx.db.query('users').first());
    const denied = await t.run((ctx) =>
      authorizeAgentStart(ctx, {
        chatroomId,
        role: 'builder',
        machineId,
        lifecycleRevision: 0,
      })
    );
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe('no_active_task');

    const builderTask = await t.run((ctx) =>
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_assignedTo_originUserMessageId', (q) =>
          q.eq('chatroomId', chatroomId).eq('assignedTo', 'builder')
        )
        .first()
    );
    const allowed = await t.run((ctx) =>
      authorizeAgentStart(ctx, {
        chatroomId,
        role: 'builder',
        machineId,
        lifecycleRevision: 0,
        taskId: builderTask!._id,
        userId: user!._id,
      })
    );
    expect(allowed.allowed).toBe(true);
  });

  test('startAgent rejects a direct start for the ephemeral builder', async () => {
    const { sessionId } = await createTestSession('builder-lifecycle-start');
    const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    const machineId = 'machine-builder-lifecycle-start';
    await registerMachineWithDaemon(sessionId, machineId);
    await t.mutation(api.workspaces.registerWorkspace, {
      sessionId,
      chatroomId,
      machineId,
      workingDir: '/workspace',
      hostname: 'test-host',
      registeredBy: 'planner',
    });
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'planner');
    await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'builder',
      content: 'Start check task',
    });

    const machine = await t.run((ctx) =>
      ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first()
    );
    const user = await t.run((ctx) => ctx.db.query('users').first());
    await expect(
      t.run((ctx) =>
        startAgent(
          ctx,
          {
            machineId,
            chatroomId,
            role: 'builder',
            userId: user!._id,
            model: 'test-model',
            agentHarness: 'opencode',
            workingDir: '/workspace',
            reason: 'test',
          },
          machine!
        )
      )
    ).rejects.toThrow(/ephemeral/i);
  });

  test('terminal builder task releases the ephemeral agent', async () => {
    const { sessionId } = await createTestSession('builder-lifecycle-release');
    const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    const machineId = 'machine-builder-lifecycle-release';
    await registerMachineWithDaemon(sessionId, machineId);
    await t.mutation(api.workspaces.registerWorkspace, {
      sessionId,
      chatroomId,
      machineId,
      workingDir: '/workspace',
      hostname: 'test-host',
      registeredBy: 'planner',
    });
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'planner');
    const handoff = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'builder',
      content: 'Release check task',
    });
    expect(handoff.success).toBe(true);

    await t.run((ctx) => requestAgentReleaseHelper(ctx, handoff.newTaskId));

    const config = await builderConfigFor(chatroomId);
    expect(config?.desiredState).toBe('stopped');
  });
});

async function requestAgentReleaseHelper(ctx: any, taskId: any) {
  const task = await ctx.db.get('chatroom_tasks', taskId);
  await ctx.db.patch(taskId, { status: 'in_progress' });
  await transitionTask(ctx, taskId, 'completed', 'completeTaskById');
  return task;
}
