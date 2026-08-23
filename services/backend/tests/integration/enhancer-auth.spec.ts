/**
 * enhancer auth — Integration Tests
 *
 * Verifies unauthorized access is rejected on daemon and web-plane endpoints.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { createTestSession, joinParticipant } from '../helpers/integration';
import { setupPlannerWorkspaceForSession } from './direct-harness/fixtures';

describe('daemon.enhancer.index unauthorized access', () => {
  test('pendingForMachine returns empty for caller without machine owner access', async () => {
    const { machineId } = await setupPlannerWorkspaceForSession('enh-auth-pending');
    const { sessionId: otherSession } = await createTestSession('enh-auth-pending-other');

    const pending = await t.query(api.daemon.enhancer.index.pendingForMachine, {
      sessionId: otherSession,
      machineId,
    });

    expect(pending).toEqual([]);
  });

  test('claimForSpawn rejects caller without machine owner access', async () => {
    const { sessionId, chatroomId, machineId } =
      await setupPlannerWorkspaceForSession('enh-auth-claim');
    const { sessionId: otherSession } = await createTestSession('enh-auth-claim-other');

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
    await t.run(async (ctx) => {
      const msgId = await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        content: 'Auth test message',
        targetRole: 'planner',
        type: 'message',
      });
      await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'Auth test message',
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
      content: 'Draft',
    });

    await expect(
      t.mutation(api.daemon.enhancer.index.claimForSpawn, {
        sessionId: otherSession,
        jobId,
        machineId,
      })
    ).rejects.toThrow(/NOT_AUTHORIZED_MACHINE/);
  });

  test('getSpawnPayload rejects caller without machine owner access', async () => {
    const { sessionId, chatroomId, machineId } =
      await setupPlannerWorkspaceForSession('enh-auth-payload');
    const { sessionId: otherSession } = await createTestSession('enh-auth-payload-other');

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
    await t.run(async (ctx) => {
      const msgId = await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        content: 'Auth test message',
        targetRole: 'planner',
        type: 'message',
      });
      await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'Auth test message',
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
      content: 'Draft content',
    });

    await t.mutation(api.daemon.enhancer.index.claimForSpawn, {
      sessionId,
      jobId,
      machineId,
    });

    await expect(
      t.query(api.daemon.enhancer.index.getSpawnPayload, {
        sessionId: otherSession,
        jobId,
      })
    ).rejects.toThrow(/NOT_AUTHORIZED_MACHINE/);
  });
});

describe('web.enhancer.index job owner access', () => {
  async function insertForeignOwnedRunningJob(prefix: string) {
    const { sessionId, chatroomId, machineId } = await setupPlannerWorkspaceForSession(prefix);
    const ownerUserId = await t.run(async (ctx) => {
      const room = await ctx.db.get(chatroomId);
      return room!.ownerId;
    });
    const { sessionId: foreignSession } = await createTestSession(`${prefix}-foreign`);
    const foreignUserId = await t.run(async (ctx) => {
      const webSession = await ctx.db
        .query('sessions')
        .withIndex('by_sessionId', (q) => q.eq('sessionId', foreignSession))
        .unique();
      return webSession!.userId;
    });
    expect(foreignUserId).not.toBe(ownerUserId);

    const jobId = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_enhancerJobs', {
        chatroomId,
        userId: foreignUserId,
        targetId: 'handoff:planner-to-builder',
        fromRole: 'planner',
        toRole: 'builder',
        status: 'running',
        draftContent: 'Original draft',
        templateSnapshot: '# Template',
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
          targetRole: 'enhancer',
        },
      });
    });

    return { sessionId, chatroomId, jobId: jobId as Id<'chatroom_enhancerJobs'> };
  }

  test('complete rejects caller who is not the job owner', async () => {
    const { sessionId, chatroomId, jobId } =
      await insertForeignOwnedRunningJob('enh-auth-complete');

    await expect(
      t.mutation(api.web.enhancer.index.complete, {
        sessionId,
        chatroomId,
        jobId,
        enhancedContent: '## Summary\nPlanning feedback\n',
      })
    ).rejects.toThrow(/NOT_AUTHORIZED_JOB/);
  });

  test('recordAttemptFailure rejects caller who is not the job owner', async () => {
    const { sessionId, chatroomId, jobId } = await insertForeignOwnedRunningJob('enh-auth-failure');

    await expect(
      t.mutation(api.web.enhancer.index.recordAttemptFailure, {
        sessionId,
        chatroomId,
        jobId,
        error: 'Timeout',
      })
    ).rejects.toThrow(/NOT_AUTHORIZED_JOB/);
  });

  test('cancelActiveJob rejects caller who is not the job owner', async () => {
    const { sessionId, chatroomId, jobId } = await insertForeignOwnedRunningJob('enh-auth-cancel');

    await expect(
      t.mutation(api.web.enhancer.index.cancelActiveJob, {
        sessionId,
        chatroomId,
        jobId,
      })
    ).rejects.toThrow(/NOT_AUTHORIZED_JOB/);
  });
});
