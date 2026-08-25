import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';
import { interruptEnhancerJobsOnChatroomStop } from './interrupt-enhancer-jobs-on-chatroom-stop';

describe('interruptEnhancerJobsOnChatroomStop', () => {
  test('resets running enhancer jobs and releases their task', async () => {
    const sessionId = 'interrupt-enhancer-stop' as SessionId;
    const login = await t.mutation(api.auth.loginAnon, { sessionId });
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });
    const { jobId, taskId } = await t.run(async (ctx) => {
      const now = Date.now();
      const taskId = await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'planner',
        content: 'enhancer task',
        status: 'in_progress',
        assignedTo: 'enhancer',
        startedAt: now,
        createdAt: now,
        updatedAt: now,
        queuePosition: 0,
      });
      const jobId = await ctx.db.insert('chatroom_enhancerJobs', {
        chatroomId,
        userId: login.userId as Id<'users'>,
        targetId: 'handoff:planner-to-builder',
        fromRole: 'planner',
        toRole: 'enhancer',
        status: 'running',
        draftContent: 'draft',
        templateSnapshot: 'template',
        agentHarness: 'opencode-sdk',
        model: 'model',
        machineId: 'machine',
        workingDir: '/tmp',
        attemptCount: 1,
        maxAttempts: 3,
        runningSince: now,
        createdAt: now,
        taskId,
      });
      return { jobId, taskId };
    });

    const result = await t.run((ctx) => interruptEnhancerJobsOnChatroomStop(ctx, chatroomId));
    expect(result.interruptedJobIds).toEqual([jobId]);
    const [job, task] = await t.run(async (ctx) => [
      await ctx.db.get('chatroom_enhancerJobs', jobId),
      await ctx.db.get('chatroom_tasks', taskId),
    ]);
    expect(job?.status).toBe('pending');
    expect(job?.lastError).toBe('interrupted_by_stop');
    expect(task?.status).toBe('pending');
    expect(task?.startedAt).toBeUndefined();
  });
});
