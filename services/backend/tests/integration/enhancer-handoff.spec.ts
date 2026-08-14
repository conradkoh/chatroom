/**
 * enhancer handoff lifecycle — Integration Tests
 *
 * Verifies enqueueHandoff, recordAttemptFailure, job lifecycle events,
 * and handoff delivery via complete.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { setupWorkspaceForSession } from './direct-harness/fixtures';
import { joinParticipant } from '../helpers/integration';

async function createPlannerUserMessageAndTask(
  sessionId: string,
  chatroomId: Id<'chatroom_rooms'>,
  content: string
): Promise<Id<'chatroom_messages'>> {
  const msgId = await t.run(async (ctx) => {
    const id = await ctx.db.insert('chatroom_messages', {
      chatroomId,
      senderRole: 'user',
      content,
      targetRole: 'planner',
      type: 'message',
    });
    await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content,
      status: 'in_progress',
      assignedTo: 'planner',
      sourceMessageId: id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      queuePosition: 1,
    });
    return id;
  });
  return msgId;
}

describe('web.enhancer.index enqueue / recordAttemptFailure / complete lifecycle', () => {
  test('rejects planner handoff to enhancer when enabled config is incomplete', async () => {
    const { sessionId, chatroomId, machineId } = await setupWorkspaceForSession('enh-incomplete-config');

    await t.run(async (ctx) => {
      const session = await ctx.db
        .query('sessions')
        .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
        .unique();
      await ctx.db.insert('chatroom_enhancerConfigs', {
        chatroomId,
        userId: session!.userId,
        enabled: true,
        targetId: 'handoff:planner-to-builder',
        agentHarness: 'opencode',
        model: '',
        machineId,
        updatedAt: Date.now(),
      });
    });

    await joinParticipant(sessionId, chatroomId, 'planner');
    await createPlannerUserMessageAndTask(sessionId, chatroomId, 'Task for incomplete enhancer');

    const result = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: 'Check-in with incomplete config',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error?.code).toBe('ENHANCER_CONFIG_INCOMPLETE');
    const jobs = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_enhancerJobs')
        .filter((q) => q.eq(q.field('chatroomId'), chatroomId))
        .collect()
    );
    expect(jobs).toHaveLength(0);
  });

  test('enqueueHandoff creates job and enhancer.job.created event', async () => {
    const { sessionId, chatroomId, machineId } = await setupWorkspaceForSession('enh-enqueue');

    // Enable enhancer config
    await t.mutation(api.web.enhancer.index.upsertConfig, {
      sessionId,
      chatroomId,
      enabled: true,
      targetId: 'handoff:planner-to-builder',
      agentHarness: 'opencode',
      model: 'anthropic/claude-opus-4',
      machineId,
    });

    await joinParticipant(sessionId, chatroomId, 'planner');

    await createPlannerUserMessageAndTask(
      sessionId,
      chatroomId,
      'Send a test message to the builder.'
    );

    const result = await t.mutation(api.web.enhancer.index.enqueueHandoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: 'Original draft content',
    });

    expect(result.jobId).toBeDefined();

    const job = await t.run(async (ctx) => ctx.db.get(result.jobId as Id<'chatroom_enhancerJobs'>));
    expect(job).toBeDefined();
    expect(job!.status).toBe('pending');
    expect(job!.draftContent).toBe('Original draft content');
    expect(job!.pendingHandoffArgs).toBeDefined();
    expect(job!.pendingHandoffArgs!.targetRole).toBe('planner');

    const plannerStatus = await t.run(async (ctx) => {
      const participant = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'planner')
        )
        .unique();
      return {
        lastStatus: participant?.lastStatus ?? null,
        exists: participant !== null,
      };
    });
    expect(plannerStatus.exists).toBe(true);
    expect(plannerStatus.lastStatus).toBe('agent.enhancing');

    const events = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom_type', (q) =>
          q.eq('chatroomId', chatroomId).eq('type', 'enhancer.job.created')
        )
        .collect()
    );
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].jobId).toBe(result.jobId);

    const draftMessages = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) =>
          q.and(
            q.eq(q.field('type'), 'handoff'),
            q.eq(q.field('senderRole'), 'planner'),
            q.eq(q.field('targetRole'), 'enhancer')
          )
        )
        .collect()
    );
    expect(draftMessages.length).toBe(1);
    expect(draftMessages[0]!.content).toBe('Original draft content');
    expect(draftMessages[0]!.visibleInAllTabOnly).toBeUndefined();
    expect(draftMessages[0]!.enhancerJobId).toBe(result.jobId);
    expect(draftMessages[0]!.taskId).toBeDefined();

    const enhancerTasks = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status_assignedTo', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'pending').eq('assignedTo', 'enhancer')
        )
        .collect()
    );
    expect(enhancerTasks.length).toBe(1);
    expect(enhancerTasks[0]!._id).toBe(job!.taskId);

    const { shouldEnqueueMessage } =
      await import('../../../src/domain/usecase/task/create-task');
    const shouldQueue = await t.run(async (ctx) => shouldEnqueueMessage(ctx, chatroomId));
    expect(shouldQueue).toBe(true);
  });

  test('enqueueHandoff rejects duplicate check-in while enhancer job is active', async () => {
    const { sessionId, chatroomId, machineId } = await setupWorkspaceForSession('enh-dup');

    await t.mutation(api.web.enhancer.index.upsertConfig, {
      sessionId,
      chatroomId,
      enabled: true,
      targetId: 'handoff:planner-to-builder',
      agentHarness: 'opencode',
      model: 'anthropic/claude-opus-4',
      machineId,
    });

    await joinParticipant(sessionId, chatroomId, 'planner');
    await createPlannerUserMessageAndTask(sessionId, chatroomId, 'First user message');

    await t.mutation(api.web.enhancer.index.enqueueHandoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: 'First draft',
    });

    await expect(
      t.mutation(api.web.enhancer.index.enqueueHandoff, {
        sessionId,
        chatroomId,
        senderRole: 'planner',
        targetRole: 'enhancer',
        content: 'Second draft',
      })
    ).rejects.toThrow(/ACTIVE_JOB_EXISTS/i);
  });

  test('rejects planner handoff to builder while enhancer review is in progress', async () => {
    const { sessionId, chatroomId, machineId } =
      await setupWorkspaceForSession('enh-block-builder');

    await t.mutation(api.web.enhancer.index.upsertConfig, {
      sessionId,
      chatroomId,
      enabled: true,
      targetId: 'handoff:planner-to-builder',
      agentHarness: 'opencode',
      model: 'anthropic/claude-opus-4',
      machineId,
    });

    await joinParticipant(sessionId, chatroomId, 'planner');
    await joinParticipant(sessionId, chatroomId, 'builder');
    await createPlannerUserMessageAndTask(sessionId, chatroomId, 'Planner check-in task');

    await t.mutation(api.web.enhancer.index.enqueueHandoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: 'Check-in draft',
    });

    const result = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'builder',
      content: 'Too early — enhancer still reviewing',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ENHANCER_REVIEW_IN_PROGRESS');
  });

  test('rejects planner handoff to user while enhancer review is in progress', async () => {
    const { sessionId, chatroomId, machineId } = await setupWorkspaceForSession('enh-block-user');

    await t.mutation(api.web.enhancer.index.upsertConfig, {
      sessionId,
      chatroomId,
      enabled: true,
      targetId: 'handoff:planner-to-builder',
      agentHarness: 'opencode',
      model: 'anthropic/claude-opus-4',
      machineId,
    });

    await joinParticipant(sessionId, chatroomId, 'planner');
    await createPlannerUserMessageAndTask(sessionId, chatroomId, 'Planner check-in task');

    await t.mutation(api.web.enhancer.index.enqueueHandoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: 'Check-in draft',
    });

    const result = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'user',
      content: 'Too early — enhancer still reviewing',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ENHANCER_REVIEW_IN_PROGRESS');
  });

  test('allows planner handoff to builder after enhancer job completes', async () => {
    const { sessionId, chatroomId, machineId } = await setupWorkspaceForSession(
      'enh-allow-after-complete'
    );

    await t.mutation(api.web.enhancer.index.upsertConfig, {
      sessionId,
      chatroomId,
      enabled: true,
      targetId: 'handoff:planner-to-builder',
      agentHarness: 'opencode',
      model: 'anthropic/claude-opus-4',
      machineId,
    });

    await joinParticipant(sessionId, chatroomId, 'planner');
    await joinParticipant(sessionId, chatroomId, 'builder');
    await createPlannerUserMessageAndTask(sessionId, chatroomId, 'Planner check-in task');

    const { jobId } = await t.mutation(api.web.enhancer.index.enqueueHandoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: 'Check-in draft',
    });

    await t.mutation(api.daemon.enhancer.index.claimForSpawn, {
      sessionId,
      jobId,
      machineId,
    });

    await t.mutation(api.web.enhancer.index.complete, {
      sessionId,
      chatroomId,
      jobId,
      enhancedContent: '## Summary\nFeedback incorporated',
    });

    const result = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'builder',
      content: 'Delegation after enhancer feedback',
    });

    expect(result.success).toBe(true);
  });

  test('complete delivers planning feedback to planner', async () => {
    const { sessionId, chatroomId, machineId } = await setupWorkspaceForSession('enh-deliver');

    await t.mutation(api.web.enhancer.index.upsertConfig, {
      sessionId,
      chatroomId,
      enabled: true,
      targetId: 'handoff:planner-to-builder',
      agentHarness: 'opencode',
      model: 'anthropic/claude-opus-4',
      machineId,
    });

    await joinParticipant(sessionId, chatroomId, 'planner');
    await createPlannerUserMessageAndTask(sessionId, chatroomId, 'Planner check-in task');

    const { jobId } = await t.mutation(api.web.enhancer.index.enqueueHandoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: 'Original draft content',
    });

    // Daemon claims the job (transitions pending → running)
    await t.mutation(api.daemon.enhancer.index.claimForSpawn, {
      sessionId,
      jobId,
      machineId,
    });

    await t.mutation(api.web.enhancer.index.complete, {
      sessionId,
      chatroomId,
      jobId,
      enhancedContent: '## Summary\nPlanning feedback\n## User intent assessment\nLooks good\n',
    });

    // Planner task should contain enhanced content, not draft
    const tasks = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'pending')
        )
        .collect()
    );
    const plannerTask = tasks.find((t) => t.assignedTo === 'planner');
    expect(plannerTask).toBeDefined();
    expect(plannerTask!.content).toContain('Planning feedback');
    expect(plannerTask!.content).not.toContain('Original draft');

    // Handoff message should be enhancer→planner with planning feedback
    const handoffMessages = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) => q.eq(q.field('type'), 'handoff'))
        .collect()
    );
    const deliveryMsg = handoffMessages.find((m) => m.senderRole === 'enhancer');
    expect(deliveryMsg).toBeDefined();
    expect(deliveryMsg!.targetRole).toBe('planner');
    expect(deliveryMsg!.enhancerJobId).toBe(jobId);
    expect(deliveryMsg!.content).toContain('Planning feedback');
    expect(deliveryMsg!.visibleInAllTabOnly).toBe(true);

    const draftMsg = handoffMessages.find(
      (m) => m.senderRole === 'planner' && m.targetRole === 'enhancer'
    );
    expect(draftMsg).toBeDefined();
    expect(draftMsg!.content).toContain('Original draft');
  });

  test('cancelActiveJob delivers planning-review-outcome envelope and marks job cancelled', async () => {
    const { sessionId, chatroomId, machineId } = await setupWorkspaceForSession('enh-cancel');

    await t.mutation(api.web.enhancer.index.upsertConfig, {
      sessionId,
      chatroomId,
      enabled: true,
      targetId: 'handoff:planner-to-builder',
      agentHarness: 'opencode',
      model: 'anthropic/claude-opus-4',
      machineId,
    });
    await joinParticipant(sessionId, chatroomId, 'planner');
    await createPlannerUserMessageAndTask(sessionId, chatroomId, 'Planner check-in task');

    const { jobId } = await t.mutation(api.web.enhancer.index.enqueueHandoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: 'Original draft content',
    });

    // Claim the job so it's running
    await t.mutation(api.daemon.enhancer.index.claimForSpawn, {
      sessionId,
      jobId,
      machineId,
    });

    // Cancel the job
    await t.mutation(api.web.enhancer.index.cancelActiveJob, {
      sessionId,
      chatroomId,
      jobId,
    });

    // Job should be marked cancelled
    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.status).toBe('cancelled');
    expect(job!.lastError).toBe('cancelled_by_user');

    const cancelEvents = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom_type', (q) =>
          q.eq('chatroomId', chatroomId).eq('type', 'enhancer.job.cancelled')
        )
        .collect()
    );
    expect(cancelEvents.length).toBeGreaterThanOrEqual(1);

    // Handoff should have been delivered with outcome envelope, not draft content
    const handoffMessages = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) => q.eq(q.field('type'), 'handoff'))
        .collect()
    );
    const msg = handoffMessages.find((m) => m.senderRole === 'enhancer');
    expect(msg).toBeDefined();
    expect(msg!.targetRole).toBe('planner');
    expect(msg!.content).toContain('<planning-review-outcome');
    expect(msg!.content).toContain('status="cancelled"');
    expect(msg!.content).not.toContain('Original draft');
    expect(msg!.enhancerJobId).toBe(jobId);
    expect(msg!.visibleInAllTabOnly).toBe(true);
  });

  test('recordAttemptFailure retries with backoff then fails after max attempts', async () => {
    const { sessionId, chatroomId, machineId } = await setupWorkspaceForSession('enh-retry-fail');
    const userId = await t.run(async (ctx) => {
      const room = await ctx.db.get(chatroomId);
      return room!.ownerId;
    });

    // Insert a running job directly
    const jobId = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_enhancerJobs', {
        chatroomId,
        userId,
        targetId: 'handoff:planner-to-builder',
        fromRole: 'planner',
        toRole: 'enhancer',
        status: 'running',
        draftContent: 'Original draft',
        templateSnapshot: '# Template\n## Goal',
        agentHarness: 'opencode',
        model: 'anthropic/claude-opus-4',
        machineId,
        workingDir: '/home/test/repo',
        attemptCount: 1,
        maxAttempts: 3,
        createdAt: Date.now(),
        runningSince: Date.now(),
        pendingHandoffArgs: {
          senderRole: 'planner',
          targetRole: 'planner',
        },
      });
    });

    // First failure (attempt 1 → attempt 2, still running)
    const result1 = await t.mutation(api.web.enhancer.index.recordAttemptFailure, {
      sessionId,
      chatroomId,
      jobId,
      error: 'Timeout on attempt 1',
    });
    expect(result1.terminal).toBe(false);
    expect(result1.status).toBe('pending');

    const job1 = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job1!.attemptCount).toBe(2);
    expect(job1!.lastError).toBe('Timeout on attempt 1');
    expect(job1!.status).toBe('pending');

    // Clear nextRetryAt so claim can succeed (daemon would respect backoff in production)
    await t.run(async (ctx) => {
      await ctx.db.patch(jobId, { nextRetryAt: undefined });
    });

    // Daemon re-claims the job for next attempt
    const claim2 = await t.mutation(api.daemon.enhancer.index.claimForSpawn, {
      sessionId,
      jobId,
      machineId,
    });
    expect(claim2.claimed).toBe(true);

    // Second failure (attempt 2 → attempt 3, pending after)
    const result2 = await t.mutation(api.web.enhancer.index.recordAttemptFailure, {
      sessionId,
      chatroomId,
      jobId,
      error: 'Timeout on attempt 2',
    });
    expect(result2.terminal).toBe(false);

    const job2 = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job2!.attemptCount).toBe(3);
    expect(job2!.status).toBe('pending');

    // Clear nextRetryAt for third attempt
    await t.run(async (ctx) => {
      await ctx.db.patch(jobId, { nextRetryAt: undefined });
    });

    // Daemon re-claims for third attempt
    await t.mutation(api.daemon.enhancer.index.claimForSpawn, {
      sessionId,
      jobId,
      machineId,
    });

    // Third failure (attempt 3 → terminal)
    const result3 = await t.mutation(api.web.enhancer.index.recordAttemptFailure, {
      sessionId,
      chatroomId,
      jobId,
      error: 'Timeout on attempt 3',
    });
    expect(result3.terminal).toBe(true);
    expect(result3.status).toBe('failed');

    const job3 = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job3!.status).toBe('failed');

    // Verify events
    const failedEvents = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom_type', (q) =>
          q.eq('chatroomId', chatroomId).eq('type', 'enhancer.job.failed')
        )
        .collect()
    );
    expect(failedEvents.length).toBeGreaterThanOrEqual(1);

    // Verify handoff was delivered with planning-review-outcome envelope (not draft content)
    const tasks = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'pending')
        )
        .collect()
    );
    const plannerTask = tasks.find((t) => t.assignedTo === 'planner');
    expect(plannerTask).toBeDefined();
    expect(plannerTask!.content).toContain('<planning-review-outcome');
    expect(plannerTask!.content).toContain('status="failed"');
    expect(plannerTask!.content).not.toContain('Original draft');

    // Handoff message should reference the enhancer job
    const handoffMessages = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) => q.eq(q.field('type'), 'handoff'))
        .collect()
    );
    const msg = handoffMessages.find((m) => m.senderRole === 'enhancer');
    expect(msg).toBeDefined();
    expect(msg!.targetRole).toBe('planner');
    expect(msg!.content).toContain('<planning-review-outcome');
    expect(msg!.content).toContain('status="failed"');
    expect(msg!.content).not.toContain('Original draft');
    expect(msg!.enhancerJobId).toBe(jobId);
    expect(msg!.visibleInAllTabOnly).toBe(true);
  });

  test('enqueueHandoff completes planner in_progress task to prevent get-next-task loop', async () => {
    const { sessionId, chatroomId, machineId } = await setupWorkspaceForSession('enh-no-loop');

    await t.mutation(api.web.enhancer.index.upsertConfig, {
      sessionId,
      chatroomId,
      enabled: true,
      targetId: 'handoff:planner-to-builder',
      agentHarness: 'opencode',
      model: 'anthropic/claude-opus-4',
      machineId,
    });

    await joinParticipant(sessionId, chatroomId, 'planner');

    // Create a user message and an in_progress task assigned to planner
    let taskId: Id<'chatroom_tasks'>;
    await t.run(async (ctx) => {
      const msgId = await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        content: 'send a test message to the builder.',
        targetRole: 'planner',
        type: 'message',
      });
      taskId = await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'send a test message to the builder.',
        status: 'in_progress',
        assignedTo: 'planner',
        sourceMessageId: msgId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        queuePosition: 1,
      });
    });

    const { jobId } = await t.mutation(api.web.enhancer.index.enqueueHandoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: '<user-message>test</user-message>',
    });

    const task = await t.run(async (ctx) => ctx.db.get(taskId!));
    expect(task!.status).toBe('completed');

    const activePlannerTasks = await t.run(async (ctx) => {
      const all = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
      return all.filter(
        (t) =>
          t.assignedTo === 'planner' &&
          ['pending', 'acknowledged', 'in_progress'].includes(t.status)
      );
    });
    expect(activePlannerTasks).toHaveLength(0);

    // After enhancer completes, planner gets NEW task (not the old one)
    await t.mutation(api.daemon.enhancer.index.claimForSpawn, {
      sessionId,
      jobId,
      machineId,
    });

    await t.mutation(api.web.enhancer.index.complete, {
      sessionId,
      chatroomId,
      jobId,
      enhancedContent: '## Summary\nFeedback\n',
    });

    const pendingPlanner = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'pending')
        )
        .collect()
    );
    expect(pendingPlanner.some((t) => t.assignedTo === 'planner')).toBe(true);
    expect(pendingPlanner.find((t) => t.assignedTo === 'planner')!._id).not.toBe(taskId!);
  });

  test('enqueueHandoff rejects second check-in after first job completes (no active task)', async () => {
    const { sessionId, chatroomId, machineId } = await setupWorkspaceForSession('enh-no-double');

    await t.mutation(api.web.enhancer.index.upsertConfig, {
      sessionId,
      chatroomId,
      enabled: true,
      targetId: 'handoff:planner-to-builder',
      agentHarness: 'opencode',
      model: 'anthropic/claude-opus-4',
      machineId,
    });

    await joinParticipant(sessionId, chatroomId, 'planner');
    await createPlannerUserMessageAndTask(sessionId, chatroomId, 'First user message');

    const { jobId } = await t.mutation(api.web.enhancer.index.enqueueHandoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: '<user-message>test</user-message>',
    });

    // Complete the job
    await t.mutation(api.daemon.enhancer.index.claimForSpawn, {
      sessionId,
      jobId,
      machineId,
    });
    await t.mutation(api.web.enhancer.index.complete, {
      sessionId,
      chatroomId,
      jobId,
      enhancedContent: '## Summary\nFeedback\n',
    });

    // Second enqueue rejected because first job completed the planner task
    await expect(
      t.mutation(api.web.enhancer.index.enqueueHandoff, {
        sessionId,
        chatroomId,
        senderRole: 'planner',
        targetRole: 'enhancer',
        content: '<user-message>another check-in</user-message>',
      })
    ).rejects.toThrow(/NO_PLANNER_USER_TASK/i);
  });

  test('enqueueHandoff completes all active tasks including builder (traditional handoff)', async () => {
    const { sessionId, chatroomId, machineId } = await setupWorkspaceForSession('enh-only-planner');

    await t.mutation(api.web.enhancer.index.upsertConfig, {
      sessionId,
      chatroomId,
      enabled: true,
      targetId: 'handoff:planner-to-builder',
      agentHarness: 'opencode',
      model: 'anthropic/claude-opus-4',
      machineId,
    });

    await joinParticipant(sessionId, chatroomId, 'planner');
    await joinParticipant(sessionId, chatroomId, 'builder');
    await createPlannerUserMessageAndTask(sessionId, chatroomId, 'Planner task');

    // Create builder in_progress task
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'planner',
        content: 'Builder task',
        status: 'in_progress',
        assignedTo: 'builder',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        queuePosition: 2,
      });
    });

    await t.mutation(api.web.enhancer.index.enqueueHandoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: '<user-message>test</user-message>',
    });

    // Planner task should be completed
    const allTasks = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect()
    );
    const plannerTask = allTasks.find((t) => t.createdBy === 'user');
    expect(plannerTask!.status).toBe('completed');

    // Traditional handoff completes all in_progress/acknowledged tasks
    const builderTask = allTasks.find((t) => t.assignedTo === 'builder');
    expect(builderTask).toBeDefined();
    expect(builderTask!.status).toBe('completed');

    const enhancerTask = allTasks.find((t) => t.assignedTo === 'enhancer');
    expect(enhancerTask).toBeDefined();
    expect(enhancerTask!.status).toBe('pending');
  });

  test('enqueueHandoff rejects second check-in after cancel', async () => {
    const { sessionId, chatroomId, machineId } =
      await setupWorkspaceForSession('enh-no-cancel-double');

    await t.mutation(api.web.enhancer.index.upsertConfig, {
      sessionId,
      chatroomId,
      enabled: true,
      targetId: 'handoff:planner-to-builder',
      agentHarness: 'opencode',
      model: 'anthropic/claude-opus-4',
      machineId,
    });

    await joinParticipant(sessionId, chatroomId, 'planner');
    await createPlannerUserMessageAndTask(sessionId, chatroomId, 'User message for cancel test');

    const { jobId } = await t.mutation(api.web.enhancer.index.enqueueHandoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: '<user-message>test</user-message>',
    });

    // Cancel the job
    await t.mutation(api.daemon.enhancer.index.claimForSpawn, {
      sessionId,
      jobId,
      machineId,
    });
    await t.mutation(api.web.enhancer.index.cancelActiveJob, {
      sessionId,
      chatroomId,
      jobId,
    });

    // Second enqueue rejected because first job completed the planner task
    await expect(
      t.mutation(api.web.enhancer.index.enqueueHandoff, {
        sessionId,
        chatroomId,
        senderRole: 'planner',
        targetRole: 'enhancer',
        content: '<user-message>another check-in</user-message>',
      })
    ).rejects.toThrow(/NO_PLANNER_USER_TASK/i);
  });

  test('handoff message has taskOriginMessageId pointing to user message', async () => {
    const { sessionId, chatroomId } = await setupWorkspaceForSession('ho-origin-msg');

    // Join planner as a participant so collectActiveTasks can find the task
    const { joinParticipant } = await import('../helpers/integration');
    await joinParticipant(sessionId, chatroomId, 'planner');

    // Create a user message and in_progress task
    const userMsgId = await t.run(async (ctx) => {
      const msgId = await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        content: 'Build feature X',
        targetRole: 'planner',
        type: 'message',
      });
      await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'Build feature X',
        status: 'in_progress',
        assignedTo: 'planner',
        sourceMessageId: msgId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        queuePosition: 1,
      });
      return msgId;
    });

    // Handoff to builder — should set taskOriginMessageId from completed task
    const handoffResult = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'builder',
      content: 'Slice complete',
    });
    expect(handoffResult).toHaveProperty('messageId');

    const handoffMsg = await t.run(async (ctx) => {
      const msgs = await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .order('desc')
        .take(5);
      return msgs.find((m) => m.type === 'handoff' && m.senderRole === 'planner');
    });

    expect(handoffMsg).toBeDefined();
    expect(handoffMsg!.taskOriginMessageId).toBe(userMsgId);
  });
});
