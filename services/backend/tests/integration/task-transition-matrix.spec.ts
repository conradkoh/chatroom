/**
 * Task Transition Matrix — Integration Tests
 *
 * Verifies task lifecycle transitions for persistent and ephemeral team roles.
 *
 * DAEMON_WORKER_ROLES must match packages/cli/src/domain/execution-kind.ts
 *
 * | Role kind | Trigger | Expected result |
 * |-----------|---------|----------------|
 * | team_agent (planner) | native:task-injected + updateTokenActivity | in_progress |
 * | team_agent (planner) | agent.waiting + updateTokenActivity (token resume) | in_progress |
 * | ephemeral (enhancer) | claimForSpawn | in_progress + participant row |
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  assertDuoTeamOnly,
  createDuoTeamChatroom,
  createTestSession,
  joinParticipant,
  registerMachineWithDaemon,
} from '../helpers/integration';

async function createSessionChatroomAndJoin(
  key: string,
  role: string
): Promise<{ sessionId: Id<'chatroom_sessions'>; chatroomId: Id<'chatroom_rooms'> }> {
  const { sessionId } = await createTestSession(key);
  const chatroomId = await createDuoTeamChatroom(sessionId);
  await joinParticipant(sessionId, chatroomId, role);
  return { sessionId, chatroomId };
}

async function seedPendingTask(
  chatroomId: Id<'chatroom_rooms'>,
  assignedTo: string
): Promise<Id<'chatroom_tasks'>> {
  return t.run(async (ctx) => {
    return ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: `Pending task for ${assignedTo}`,
      status: 'pending',
      assignedTo,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      queuePosition: 0,
    });
  });
}

describe('task transition matrix', () => {
  test('team agent + native:task-injected + updateTokenActivity -> in_progress', async () => {
    const { sessionId: _sessionId, chatroomId } = await createSessionChatroomAndJoin(
      'ttm-injected',
      'planner'
    );
    await assertDuoTeamOnly(chatroomId);

    const taskId = await seedPendingTask(chatroomId, 'planner');

    // Manually acknowledge the pending task to simulate native injection
    await t.run(async (ctx) => {
      const task = await ctx.db.get('chatroom_tasks', taskId);
      if (task && task.status === 'pending') {
        await ctx.db.patch('chatroom_tasks', taskId, { status: 'acknowledged' });
      }
    });
    expect(await t.run(async (ctx) => (await ctx.db.get('chatroom_tasks', taskId))?.status)).toBe(
      'acknowledged'
    );

    // Simulate token activity after native injection
    const { startTaskFromTokenActivity } =
      await import('../../src/domain/usecase/participant/start-task-from-token-activity');
    await t.run(async (ctx) => {
      await startTaskFromTokenActivity(
        ctx,
        { chatroomId, role: 'planner' },
        {
          lastSeenAction: 'native:task-injected',
        }
      );
    });

    const status = await t.run(async (ctx) => (await ctx.db.get('chatroom_tasks', taskId))?.status);
    expect(status).toBe('in_progress');
  });

  test('team agent + agent.waiting + updateTokenActivity (token resume) -> in_progress', async () => {
    const { sessionId: _sessionId, chatroomId } = await createSessionChatroomAndJoin(
      'ttm-waiting',
      'planner'
    );
    await assertDuoTeamOnly(chatroomId);

    const taskId = await seedPendingTask(chatroomId, 'planner');

    // Manually acknowledge the pending task
    await t.run(async (ctx) => {
      const task = await ctx.db.get('chatroom_tasks', taskId);
      if (task && task.status === 'pending') {
        await ctx.db.patch('chatroom_tasks', taskId, { status: 'acknowledged' });
      }
    });

    const { startTaskFromTokenActivity } =
      await import('../../src/domain/usecase/participant/start-task-from-token-activity');
    await t.run(async (ctx) => {
      await startTaskFromTokenActivity(
        ctx,
        { chatroomId, role: 'planner' },
        {
          lastStatus: 'agent.waiting',
        }
      );
    });

    const status = await t.run(async (ctx) => (await ctx.db.get('chatroom_tasks', taskId))?.status);
    expect(status).toBe('in_progress');
  });

  test('ephemeral role + claimForSpawn -> in_progress and registers participant', async () => {
    const { sessionId } = await createTestSession('ttm-worker');
    const cId = await createDuoTeamChatroom(sessionId);
    await assertDuoTeamOnly(cId);

    await registerMachineWithDaemon(sessionId, 'machine-ttm-worker');

    // Seed enhancer job directly
    const userId = await t.run(async (ctx) => {
      const users = await ctx.db.query('users').collect();
      return users[0]!._id;
    });

    const jobId = await t.run(async (ctx) => {
      return ctx.db.insert('chatroom_enhancerJobs', {
        chatroomId: cId,
        userId,
        targetId: 'handoff:planner-to-builder',
        fromRole: 'planner',
        toRole: 'enhancer',
        status: 'pending',
        draftContent: 'draft',
        templateSnapshot: 'template',
        agentHarness: 'opencode',
        model: 'm',
        machineId: 'machine-ttm-worker',
        workingDir: '/tmp',
        attemptCount: 1,
        maxAttempts: 3,
        createdAt: Date.now(),
      });
    });

    const taskId = await seedPendingTask(cId, 'enhancer');

    // Link task to job
    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_enhancerJobs', jobId, { taskId });
    });

    // Claim for spawn
    const claim = await t.mutation(api.daemon.enhancer.index.claimForSpawn, {
      sessionId,
      jobId,
      machineId: 'machine-ttm-worker',
    });
    expect(claim.claimed).toBe(true);

    // After claim, the enhancer task should exist and be in_progress
    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task).toBeDefined();
    expect(task!.status).toBe('in_progress');

    // The active enhancer invocation is visible as a participant.
    const enhancerParticipant = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) => q.eq('chatroomId', cId).eq('role', 'enhancer'))
        .first();
    });
    expect(enhancerParticipant).toMatchObject({
      role: 'enhancer',
      agentType: 'remote',
      lastSeenAction: 'enhancer:started',
    });
  });
});
