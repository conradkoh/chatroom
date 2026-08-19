/**
 * enhancer daemon spawn lifecycle — Integration Tests
 *
 * Verifies pending job query, claim for spawn, spawn payload, and nextRetryAt filtering.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  assertDuoTeamOnly,
  createTestSession,
  createDuoTeamChatroom,
  joinParticipant,
  registerMachineWithDaemon,
} from '../helpers/integration';
import { setupWorkspaceForSession } from './direct-harness/fixtures';

async function createPlannerUserMessageAndTask(
  sessionId: string,
  chatroomId: Id<'chatroom_rooms'>,
  content: string
): Promise<Id<'chatroom_messages'>> {
  await joinParticipant(sessionId, chatroomId, 'planner');
  return t.run(async (ctx) => {
    const msgId = await ctx.db.insert('chatroom_messages', {
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
      sourceMessageId: msgId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      queuePosition: 1,
    });
    return msgId;
  });
}

describe('daemon.enhancer.index', () => {
  test('enqueueHandoff creates job with status pending', async () => {
    const { sessionId, chatroomId, machineId } = await setupWorkspaceForSession('enh-pending');

    await t.mutation(api.web.enhancer.index.upsertConfig, {
      sessionId,
      chatroomId,
      enabled: true,
      targetId: 'handoff:planner-to-builder',
      agentHarness: 'opencode',
      model: 'anthropic/claude-opus-4',
      machineId,
    });

    await createPlannerUserMessageAndTask(sessionId, chatroomId, 'Spawn test message');

    const { jobId } = await t.mutation(api.web.enhancer.index.enqueueHandoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: 'Draft content',
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId as Id<'chatroom_enhancerJobs'>));
    expect(job!.status).toBe('pending');
    expect(job!.runningSince).toBeUndefined();
  });

  test('participants.join rejects enhancer role', async () => {
    const { sessionId } = await createTestSession('enh-join-fail');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await expect(
      t.mutation(api.participants.join, {
        sessionId,
        chatroomId,
        role: 'enhancer',
        action: 'native:waiting',
      })
    ).rejects.toThrow(/Invalid role/i);
  });

  test('claimForSpawn transitions pending to running; second claim returns false', async () => {
    const { sessionId, chatroomId, machineId } = await setupWorkspaceForSession('enh-claim');

    await assertDuoTeamOnly(chatroomId);
    await t.mutation(api.web.enhancer.index.upsertConfig, {
      sessionId,
      chatroomId,
      enabled: true,
      targetId: 'handoff:planner-to-builder',
      agentHarness: 'opencode',
      model: 'anthropic/claude-opus-4',
      machineId,
    });

    await createPlannerUserMessageAndTask(sessionId, chatroomId, 'Claim test message');

    const { jobId } = await t.mutation(api.web.enhancer.index.enqueueHandoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: 'Draft',
    });

    // First claim succeeds
    const claim1 = await t.mutation(api.daemon.enhancer.index.claimForSpawn, {
      sessionId,
      jobId,
      machineId,
    });
    expect(claim1.claimed).toBe(true);

    const job = await t.run(async (ctx) => ctx.db.get(jobId as Id<'chatroom_enhancerJobs'>));
    expect(job!.status).toBe('running');
    expect(job!.runningSince).toBeDefined();

    const enhancerTask = await t.run(async (ctx) => {
      if (!job!.taskId) return null;
      return ctx.db.get(job!.taskId);
    });
    expect(enhancerTask?.status).toBe('in_progress');
    expect(enhancerTask?.assignedTo).toBe('enhancer');

    // Second claim returns false
    const claim2 = await t.mutation(api.daemon.enhancer.index.claimForSpawn, {
      sessionId,
      jobId,
      machineId,
    });
    expect(claim2.claimed).toBe(false);
  });

  test('getSpawnPayload returns prompt and envelope for running job', async () => {
    const { sessionId, chatroomId, machineId } = await setupWorkspaceForSession('enh-payload');

    await t.mutation(api.web.enhancer.index.upsertConfig, {
      sessionId,
      chatroomId,
      enabled: true,
      targetId: 'handoff:planner-to-builder',
      agentHarness: 'opencode',
      model: 'anthropic/claude-opus-4',
      machineId,
    });

    const originUserMessageId = await createPlannerUserMessageAndTask(
      sessionId,
      chatroomId,
      'Payload test message'
    );

    const { jobId } = await t.mutation(api.web.enhancer.index.enqueueHandoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: '<request>Payload test message</request>',
    });

    await t.mutation(api.daemon.enhancer.index.claimForSpawn, {
      sessionId,
      jobId,
      machineId,
    });

    const payload = await t.query(api.daemon.enhancer.index.getSpawnPayload, {
      sessionId,
      jobId,
    });

    expect(payload.agentHarness).toBe('opencode');
    expect(payload.workingDir).toBeDefined();
    expect(payload.systemPrompt).toContain('enhancer complete');
    expect(payload.systemPrompt).toContain(jobId);
    expect(payload.systemPrompt).toContain('messages download');
    expect(payload.systemPrompt).toContain(`--since-message-id="${originUserMessageId}"`);
    expect(payload.systemPrompt).toContain('single-turn, memoryless **planning advisor**');
    expect(payload.systemPrompt).not.toContain('planner→builder');
    expect(payload.systemPrompt).not.toContain('planner→user');
    expect(payload.taskEnvelope).toContain(`origin-user-message-id="${originUserMessageId}"`);
    expect(payload.taskEnvelope).toContain('<output-template>');
    expect(payload.taskEnvelope).toContain('Planning Input (Enhancer → Planner)');
    expect(payload.taskEnvelope).toContain('<forwarded-request>');
    expect(payload.taskEnvelope).toContain('&lt;request&gt;Payload test message&lt;/request&gt;');
    expect(payload.taskEnvelope).not.toContain('<handoff-templates>');
    expect(payload.taskEnvelope).not.toContain('<references>');
    expect(payload.taskEnvelope).not.toContain('<planner-check-in>');
    expect(payload.taskEnvelope).toContain('### Defragmentation workflow checklist');
    expect(payload.taskEnvelope).toContain('&lt;handoff-defragmentation&gt;');
    expect(payload.taskEnvelope).toContain('optional **Defragmentation** section');
  });

  test('pendingForMachine respects nextRetryAt filter', async () => {
    const { sessionId } = await createTestSession('enh-nextretry');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'test-machine-nr';
    await registerMachineWithDaemon(sessionId, machineId);
    const userId = await t.run(async (ctx) => {
      const room = await ctx.db.get(chatroomId);
      return room!.ownerId;
    });

    const futureRetryAt = Date.now() + 60_000;
    const noRetryJobId = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_enhancerJobs', {
        chatroomId,
        userId,
        targetId: 'handoff:planner-to-builder',
        fromRole: 'planner',
        toRole: 'builder',
        status: 'pending',
        draftContent: 'Draft 1',
        templateSnapshot: '# T',
        agentHarness: 'opencode',
        model: 'm1',
        machineId,
        workingDir: '/home/test/repo',
        attemptCount: 1,
        maxAttempts: 3,
        createdAt: Date.now(),
      });
    });

    const futureRetryJobId = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_enhancerJobs', {
        chatroomId,
        userId,
        targetId: 'handoff:planner-to-builder',
        fromRole: 'planner',
        toRole: 'builder',
        status: 'pending',
        draftContent: 'Draft 2',
        templateSnapshot: '# T',
        agentHarness: 'opencode',
        model: 'm1',
        machineId,
        workingDir: '/home/test/repo',
        attemptCount: 2,
        maxAttempts: 3,
        createdAt: Date.now(),
        nextRetryAt: futureRetryAt,
      });
    });

    const pending = await t.query(api.daemon.enhancer.index.pendingForMachine, {
      sessionId,
      machineId,
    });

    const ids = pending.map((j: { jobId: Id<'chatroom_enhancerJobs'> }) => j.jobId);
    expect(ids).toContain(noRetryJobId);
    expect(ids).not.toContain(futureRetryJobId);
  });
});
