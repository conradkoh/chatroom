/**
 * enhancer daemon spawn lifecycle — Integration Tests
 *
 * Verifies pending job query, claim for spawn, spawn payload, and nextRetryAt filtering.
 */

import { describe, expect, test } from 'vitest';

import { setupPlannerWorkspaceForSession } from './harness-fixtures';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { insertEnhancerJob } from '../helpers/enhancer-job';
import {
  addEnhancerToTeamRoles,
  enableEnhancerTeamAgent,
  createTestSession,
  createDuoTeamChatroom,
  joinParticipant,
  registerMachineWithDaemon,
} from '../helpers/integration';

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
  test('request-first handoff creates enhancer task and job', async () => {
    const { sessionId, chatroomId, machineId } =
      await setupPlannerWorkspaceForSession('enh-pending');

    await enableEnhancerTeamAgent(sessionId, chatroomId, machineId);

    const originUserMessageId = await createPlannerUserMessageAndTask(
      sessionId,
      chatroomId,
      'Spawn test message'
    );

    const handoff = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: 'Draft content',
    });
    expect(handoff.success).toBe(true);

    const enhancerTask = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) => q.eq(q.field('assignedTo'), 'enhancer'))
        .first()
    );
    expect(enhancerTask?.status).toBe('pending');
    expect(enhancerTask?.originUserMessageId).toBe(originUserMessageId);
    expect(
      await t.run(async (ctx) =>
        ctx.db
          .query('chatroom_enhancerJobs')
          .withIndex('by_chatroom_status', (q) => q.eq('chatroomId', chatroomId))
          .collect()
      )
    ).toHaveLength(1);
  });

  test('participants.join accepts enhancer role from static team structure', async () => {
    const { sessionId } = await createTestSession('enh-join-fail');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const participantId = await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'enhancer',
      action: 'enhancer:started',
    });
    expect(participantId).toBeDefined();
  });

  test('claimForSpawn transitions pending to running; second claim returns false', async () => {
    const { sessionId, chatroomId, machineId } = await setupPlannerWorkspaceForSession('enh-claim');
    await addEnhancerToTeamRoles(chatroomId);

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
      'Claim test message'
    );
    const userId = await t.run(async (ctx) => (await ctx.db.get(chatroomId))!.ownerId);
    const { jobId } = await insertEnhancerJob({
      chatroomId,
      userId,
      machineId,
      originUserMessageId,
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
    expect(
      await t.run(async (ctx) =>
        ctx.db
          .query('chatroom_participants')
          .withIndex('by_chatroom_and_role', (q) =>
            q.eq('chatroomId', chatroomId).eq('role', 'enhancer')
          )
          .first()
      )
    ).toMatchObject({ agentType: 'remote', lastSeenAction: 'enhancer:started' });

    // Second claim returns false
    const claim2 = await t.mutation(api.daemon.enhancer.index.claimForSpawn, {
      sessionId,
      jobId,
      machineId,
    });
    expect(claim2.claimed).toBe(false);
  });

  test('getSpawnPayload returns prompt and envelope for running job', async () => {
    const { sessionId, chatroomId, machineId } =
      await setupPlannerWorkspaceForSession('enh-payload');
    await addEnhancerToTeamRoles(chatroomId);

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
    const userId = await t.run(async (ctx) => (await ctx.db.get(chatroomId))!.ownerId);
    const { jobId } = await insertEnhancerJob({
      chatroomId,
      userId,
      machineId,
      originUserMessageId,
      draftContent: '<request>Payload test message</request>',
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
    expect(payload.systemPrompt).toContain('chatroom handoff');
    expect(payload.jobId).toBe(jobId);
    expect(payload.systemPrompt).toContain('messages download');
    expect(payload.systemPrompt).toContain(`--since-message-id="${originUserMessageId}"`);
    expect(payload.systemPrompt).toContain('single-turn, memoryless **design advisor**');
    expect(payload.systemPrompt).not.toContain('planner→builder');
    expect(payload.systemPrompt).not.toContain('planner→user');
    expect(payload.taskEnvelope).toContain(`origin-user-message-id="${originUserMessageId}"`);
    expect(payload.taskEnvelope).toContain('<output-template>');
    expect(payload.taskEnvelope).toContain('# Template');
    expect(payload.taskEnvelope).toContain('<forwarded-request>');
    expect(payload.taskEnvelope).toContain('&lt;request&gt;Payload test message&lt;/request&gt;');
    expect(payload.taskEnvelope).not.toContain('<handoff-templates>');
    expect(payload.taskEnvelope).not.toContain('<references>');
    expect(payload.taskEnvelope).not.toContain('<planner-check-in>');
    expect(payload.taskEnvelope).toContain('<requirements>');
    expect(payload.taskEnvelope).toContain('one complete recommended design');
    expect(payload.taskEnvelope).toContain('<cli-handoff-command>');
    expect(payload.taskEnvelope).toContain('chatroom handoff');
    expect(payload.taskEnvelope).not.toContain('enhancer complete');
  });

  test('getTaskDeliveryForJob returns task-pipeline delivery with handoff', async () => {
    const { sessionId, chatroomId, machineId } =
      await setupPlannerWorkspaceForSession('enh-task-delivery-job');
    await addEnhancerToTeamRoles(chatroomId);

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
      'Task delivery job test'
    );
    const userId = await t.run(async (ctx) => (await ctx.db.get(chatroomId))!.ownerId);
    const { jobId } = await insertEnhancerJob({
      chatroomId,
      userId,
      machineId,
      originUserMessageId,
      draftContent: '<request>Task delivery payload</request>',
    });

    await t.mutation(api.daemon.enhancer.index.claimForSpawn, {
      sessionId,
      jobId,
      machineId,
    });

    const delivery = await t.query(api.daemon.enhancer.index.getTaskDeliveryForJob, {
      sessionId,
      jobId,
      convexUrl: 'http://127.0.0.1:3210',
    });

    expect(delivery.agentHarness).toBe('opencode');
    expect(delivery.taskDeliveryOutput).toContain('chatroom handoff');
    expect(delivery.taskDeliveryOutput).not.toContain('enhancer complete');
    expect(delivery.taskDeliveryOutput).toContain(String(originUserMessageId));
    expect(delivery.systemPrompt).toContain('single-turn, memoryless **design advisor**');
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
