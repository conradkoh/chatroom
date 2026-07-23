/**
 * enhancer complete mutation — Integration Tests
 *
 * Verifies job status transitions and content validation.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { createTestSession, createDuoTeamChatroom } from '../helpers/integration';

async function getChatroomOwnerId(chatroomId: Id<'chatroom_rooms'>): Promise<Id<'users'>> {
  const chatroom = await t.run(async (ctx) => ctx.db.get(chatroomId));
  if (!chatroom) throw new Error('Chatroom not found');
  return chatroom.ownerId;
}

async function insertJob(
  chatroomId: Id<'chatroom_rooms'>,
  overrides: Partial<{
    status: 'pending' | 'running' | 'complete' | 'failed';
  }> = {}
): Promise<Id<'chatroom_enhancerJobs'>> {
  const userId = await getChatroomOwnerId(chatroomId);
  return await t.run(async (ctx) => {
    return await ctx.db.insert('chatroom_enhancerJobs', {
      chatroomId,
      userId,
      targetId: 'handoff:planner-to-builder',
      fromRole: 'planner',
      toRole: 'builder',
      status: overrides.status ?? 'running',
      draftContent: 'Original draft',
      templateSnapshot: '# Template\n## Goal',
      agentHarness: 'opencode',
      model: 'anthropic/claude-opus-4',
      machineId: 'machine-1',
      workingDir: '/home/test/repo',
      attemptCount: 1,
      maxAttempts: 3,
      createdAt: Date.now(),
    });
  });
}

describe('web.enhancer.index.complete', () => {
  test('completes a running job with enhanced content', async () => {
    const { sessionId } = await createTestSession('enhancer-complete-happy');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const jobId = await insertJob(chatroomId);

    const result = await t.mutation(api.web.enhancer.index.complete, {
      sessionId,
      chatroomId,
      jobId,
      enhancedContent: '## Goal\nEnhanced brief content\n',
    });

    expect(result.success).toBe(true);

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.status).toBe('complete');
    expect(job!.enhancedContent).toBe('## Goal\nEnhanced brief content');
    expect(job!.completedAt).toBeDefined();
  });

  test('rejects empty content', async () => {
    const { sessionId } = await createTestSession('enhancer-complete-empty');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const jobId = await insertJob(chatroomId);

    await expect(
      t.mutation(api.web.enhancer.index.complete, {
        sessionId,
        chatroomId,
        jobId,
        enhancedContent: '',
      })
    ).rejects.toThrow(/must not be empty/);
  });

  test('rejects complete on pending job', async () => {
    const { sessionId } = await createTestSession('enhancer-complete-wrong-status');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const jobId = await insertJob(chatroomId, { status: 'pending' });

    await expect(
      t.mutation(api.web.enhancer.index.complete, {
        sessionId,
        chatroomId,
        jobId,
        enhancedContent: 'Some content',
      })
    ).rejects.toThrow(/must be running/);
  });

  test('rejects when job chatroomId does not match', async () => {
    const { sessionId } = await createTestSession('enhancer-complete-wrong-room');
    const chatroomA = await createDuoTeamChatroom(sessionId);
    const chatroomB = await createDuoTeamChatroom(sessionId);
    const jobId = await insertJob(chatroomA);

    await expect(
      t.mutation(api.web.enhancer.index.complete, {
        sessionId,
        chatroomId: chatroomB,
        jobId,
        enhancedContent: 'Some content',
      })
    ).rejects.toThrow(/Enhancer job not found/);
  });
});
