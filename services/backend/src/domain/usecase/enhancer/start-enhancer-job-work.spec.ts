/**
 * Unit tests for startEnhancerJobWork — enhancer daemon worker task lifecycle.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { startEnhancerJobWork } from './start-enhancer-job-work';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';

async function createTestSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId };
}

async function createDuoChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'builder',
  });
}

function makeJobFields(
  chatroomId: Id<'chatroom_rooms'>,
  userId: Id<'users'>,
  taskId: Id<'chatroom_tasks'>
) {
  return {
    chatroomId,
    userId,
    targetId: 'handoff:planner-to-builder' as const,
    fromRole: 'planner',
    toRole: 'enhancer',
    status: 'running' as const,
    draftContent: 'draft',
    templateSnapshot: 'template',
    agentHarness: 'opencode-sdk',
    model: 'm',
    machineId: 'machine',
    workingDir: '/tmp',
    attemptCount: 1,
    maxAttempts: 3,
    createdAt: Date.now(),
    runningSince: Date.now(),
    taskId,
  };
}

describe('startEnhancerJobWork', () => {
  test('transitions linked pending task to in_progress without enhancer in teamRoles', async () => {
    const { sessionId } = await createTestSession('enhancer-job-work');
    const chatroomId = await createDuoChatroom(sessionId);

    const { taskId, userId } = await t.run(async (ctx) => {
      const room = await ctx.db.get(chatroomId);
      const msgId = await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'planner',
        content: 'handoff draft',
        targetRole: 'enhancer',
        type: 'handoff',
      });
      const taskId = await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'planner',
        content: 'handoff draft',
        status: 'pending',
        assignedTo: 'enhancer',
        sourceMessageId: msgId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        queuePosition: 0,
      });
      return { taskId, userId: room!.ownerId };
    });

    const job = await t.run(async (ctx) => {
      const jobId = await ctx.db.insert(
        'chatroom_enhancerJobs',
        makeJobFields(chatroomId, userId, taskId)
      );
      const job = await ctx.db.get('chatroom_enhancerJobs', jobId);
      if (!job) throw new Error('enhancer job not found');
      return job;
    });

    await t.run(async (ctx) => {
      await startEnhancerJobWork(ctx, job);
    });

    const task = await t.run(async (ctx) => ctx.db.get(taskId));
    expect(task!.status).toBe('in_progress');
  });

  test('no-ops when job has no linked taskId', async () => {
    const { sessionId } = await createTestSession('enhancer-job-work-notask');
    const chatroomId = await createDuoChatroom(sessionId);

    const userId = await t.run(async (ctx) => {
      const room = await ctx.db.get(chatroomId);
      return room!.ownerId;
    });

    await t.run(async (ctx) => {
      const jobId = await ctx.db.insert('chatroom_enhancerJobs', {
        ...makeJobFields(chatroomId, userId, 'task1' as Id<'chatroom_tasks'>),
        taskId: undefined,
      });
      const job = await ctx.db.get('chatroom_enhancerJobs', jobId);
      if (!job) throw new Error('enhancer job not found');
      await startEnhancerJobWork(ctx, job);
    });
  });
});
