/**
 * Tests for releaseTasksOnAgentExit — tasks retain role assignment when released.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import {
  releaseTasksOnAgentExit,
  reassignInFlightTasksOnTeamSwitch,
} from './release-tasks-on-agent-exit';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';

async function createTestSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId };
}

async function createBuilderEntryThreeRoleChatroom(
  sessionId: SessionId
): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'custom',
    teamName: 'Custom Three-Role Team',
    teamRoles: ['planner', 'builder', 'architect'],
    teamEntryPoint: 'builder',
  });
}

async function seedAcknowledgedBuilderTask(
  chatroomId: Id<'chatroom_rooms'>
): Promise<Id<'chatroom_tasks'>> {
  const now = Date.now();
  return await t.run(async (ctx) => {
    return await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: 'builder task',
      status: 'acknowledged',
      assignedTo: 'builder',
      acknowledgedAt: now,
      queuePosition: 0,
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe('releaseTasksOnAgentExit', () => {
  test('retains assignedTo, sets pending, clears acknowledgedAt and startedAt', async () => {
    const { sessionId } = await createTestSession('release-exit-1');
    const chatroomId = await createBuilderEntryThreeRoleChatroom(sessionId);
    const taskId = await seedAcknowledgedBuilderTask(chatroomId);

    const released = await t.run(async (ctx) => {
      return await releaseTasksOnAgentExit(ctx, { chatroomId, role: 'builder' });
    });

    expect(released).toBe(1);

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task?.status).toBe('pending');
    expect(task?.assignedTo).toBe('builder');
    expect(task?.acknowledgedAt).toBeUndefined();
    expect(task?.startedAt).toBeUndefined();
  });

  test('planner cannot claim task released for builder', async () => {
    const { sessionId } = await createTestSession('release-exit-2');
    const chatroomId = await createBuilderEntryThreeRoleChatroom(sessionId);
    const taskId = await seedAcknowledgedBuilderTask(chatroomId);

    await t.run(async (ctx) => {
      await releaseTasksOnAgentExit(ctx, { chatroomId, role: 'builder' });
    });

    await expect(
      t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'planner',
        taskId,
      })
    ).rejects.toThrow(/not claimable by role planner/i);
  });
});

describe('reassignInFlightTasksOnTeamSwitch', () => {
  test('reassigns an already-pending task from a stale role to the new entry point', async () => {
    const { sessionId } = await createTestSession('team-switch-pending-1');
    const chatroomId = await createBuilderEntryThreeRoleChatroom(sessionId); // entry point 'builder'

    // A pending task left assigned to 'architect' (a role being removed on switch).
    const now = Date.now();
    const taskId = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'stale pending task',
        status: 'pending',
        assignedTo: 'architect',
        queuePosition: 0,
        createdAt: now,
        updatedAt: now,
      });
    });

    // Simulate updateTeam having already switched the entry point to 'planner'.
    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_rooms', chatroomId, {
        teamRoles: ['planner', 'builder'],
        teamEntryPoint: 'planner',
      });
    });

    const reassigned = await t.run(async (ctx) => {
      return await reassignInFlightTasksOnTeamSwitch(ctx, chatroomId);
    });

    expect(reassigned).toBe(1);

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task?.status).toBe('pending');
    expect(task?.assignedTo).toBe('planner');
  });

  test('leaves a pending task already assigned to the entry point unchanged', async () => {
    const { sessionId } = await createTestSession('team-switch-pending-2');
    const chatroomId = await createBuilderEntryThreeRoleChatroom(sessionId); // entry point 'builder'

    const now = Date.now();
    const taskId = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'entry pending task',
        status: 'pending',
        assignedTo: 'builder',
        queuePosition: 0,
        createdAt: now,
        updatedAt: now,
      });
    });

    const reassigned = await t.run(async (ctx) => {
      return await reassignInFlightTasksOnTeamSwitch(ctx, chatroomId);
    });

    expect(reassigned).toBe(0);

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task?.assignedTo).toBe('builder');
  });

  test('moves an acknowledged task on a removed role to pending under the new entry point', async () => {
    const { sessionId } = await createTestSession('team-switch-ack-1');
    const chatroomId = await createBuilderEntryThreeRoleChatroom(sessionId); // entry point 'builder'

    // An acknowledged task claimed by 'architect' — a role removed on the switch.
    const now = Date.now();
    const taskId = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'acknowledged architect task',
        status: 'acknowledged',
        assignedTo: 'architect',
        acknowledgedAt: now,
        queuePosition: 0,
        createdAt: now,
        updatedAt: now,
      });
    });

    // Simulate updateTeam having already switched the entry point to 'planner'.
    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_rooms', chatroomId, {
        teamRoles: ['planner', 'builder'],
        teamEntryPoint: 'planner',
      });
    });

    const reassigned = await t.run(async (ctx) => {
      return await reassignInFlightTasksOnTeamSwitch(ctx, chatroomId);
    });

    expect(reassigned).toBe(1);

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task?.status).toBe('pending');
    expect(task?.assignedTo).toBe('planner');
    expect(task?.acknowledgedAt).toBeUndefined();
  });

  test('moves an in_progress task on a removed role to pending under the new entry point', async () => {
    const { sessionId } = await createTestSession('team-switch-inprogress-1');
    const chatroomId = await createBuilderEntryThreeRoleChatroom(sessionId); // entry point 'builder'

    // An in_progress task being worked by 'architect' — a role removed on the switch.
    const now = Date.now();
    const taskId = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'in-progress architect task',
        status: 'in_progress',
        assignedTo: 'architect',
        acknowledgedAt: now,
        startedAt: now,
        queuePosition: 0,
        createdAt: now,
        updatedAt: now,
      });
    });

    // Simulate updateTeam having already switched the entry point to 'planner'.
    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_rooms', chatroomId, {
        teamRoles: ['planner', 'builder'],
        teamEntryPoint: 'planner',
      });
    });

    const reassigned = await t.run(async (ctx) => {
      return await reassignInFlightTasksOnTeamSwitch(ctx, chatroomId);
    });

    expect(reassigned).toBe(1);

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task?.status).toBe('pending');
    expect(task?.assignedTo).toBe('planner');
    expect(task?.startedAt).toBeUndefined();
  });
});
