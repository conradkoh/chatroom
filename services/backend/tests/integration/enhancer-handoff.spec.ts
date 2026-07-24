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

describe('web.enhancer.index enqueue / recordAttemptFailure / complete lifecycle', () => {
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

    const result = await t.mutation(api.web.enhancer.index.enqueueHandoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'builder',
      content: 'Original draft content',
    });

    expect(result.jobId).toBeDefined();

    const job = await t.run(async (ctx) => ctx.db.get(result.jobId as Id<'chatroom_enhancerJobs'>));
    expect(job).toBeDefined();
    expect(job!.status).toBe('pending');
    expect(job!.draftContent).toBe('Original draft content');
    expect(job!.pendingHandoffArgs).toBeDefined();
    expect(job!.pendingHandoffArgs!.senderRole).toBe('planner');

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
  });

  test('enqueueHandoff rejects when an active job already exists', async () => {
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

    await t.mutation(api.web.enhancer.index.enqueueHandoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'builder',
      content: 'First draft',
    });

    await expect(
      t.mutation(api.web.enhancer.index.enqueueHandoff, {
        sessionId,
        chatroomId,
        senderRole: 'planner',
        targetRole: 'builder',
        content: 'Second draft',
      })
    ).rejects.toThrow(/ACTIVE_JOB_EXISTS|already active/i);
  });

  test('complete delivers handoff with enhanced content (builder task has enhanced text)', async () => {
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

    const { jobId } = await t.mutation(api.web.enhancer.index.enqueueHandoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'builder',
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
      enhancedContent: '## Goal\nEnhanced brief\n## Implementation\nDo the enhanced work\n',
    });

    // Builder task should contain enhanced content, not draft
    const tasks = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'pending')
        )
        .collect()
    );
    const builderTask = tasks.find((t) => t.assignedTo === 'builder');
    expect(builderTask).toBeDefined();
    expect(builderTask!.content).toContain('Enhanced brief');
    expect(builderTask!.content).not.toContain('Original draft');

    // Handoff message should have enhancerJobId set
    const handoffMessages = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) => q.eq(q.field('type'), 'handoff'))
        .collect()
    );
    const msg = handoffMessages.find((m) => m.senderRole === 'planner');
    expect(msg).toBeDefined();
    expect(msg!.enhancerJobId).toBe(jobId);
    expect(msg!.content).toContain('Enhanced brief');
  });

  test('cancelActiveJob delivers draft content and marks job cancelled', async () => {
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

    const { jobId } = await t.mutation(api.web.enhancer.index.enqueueHandoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'builder',
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

    // Handoff should have been delivered with draft content
    const handoffMessages = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) => q.eq(q.field('type'), 'handoff'))
        .collect()
    );
    const msg = handoffMessages.find((m) => m.senderRole === 'planner');
    expect(msg).toBeDefined();
    expect(msg!.content).toContain('Original draft');
    expect(msg!.enhancerJobId).toBe(jobId);
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
        toRole: 'builder',
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

    // Verify no handoff task was created
    const tasks = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'pending')
        )
        .collect()
    );
    expect(tasks.length).toBe(0);
  });
});
