/**
 * P7 daemon-orchestration intents — Integration Tests
 *
 * Verifies: sendMessage (user) creates a task + intent row for the machine;
 * subscribeDaemonOrchestrationIntentsSince returns it with the correct
 * machineId/revisionKey; cursor replay is idempotent.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import {
  createDuoTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../helpers/integration';

describe('daemon-orchestration intents (P7)', () => {
  test('sendMessage creates a user-message intent row for the machine', async () => {
    const { sessionId } = await createTestSession('p7-intent-create');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'p7-intent-machine';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      type: 'message',
      content: '## Goal\nCreate the P7 intent row',
    });

    const intentRows = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_daemonOrchestrationIntents')
        .withIndex('by_machineId_taskId', (q) => q.eq('machineId', machineId))
        .collect();
    });
    expect(intentRows).toHaveLength(1);
    expect(intentRows[0]).toMatchObject({
      machineId,
      chatroomId,
      role: 'builder',
      intentType: 'user_message',
      status: 'pending',
      messageId,
    });
    expect(intentRows[0].revisionKey).toContain(':');
  });

  test('subscribe returns the intent with correct machineId + cursor; replay is idempotent', async () => {
    const { sessionId } = await createTestSession('p7-intent-subscribe');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'p7-intent-machine-2';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      type: 'message',
      content: '## Goal\nIntent subscribe test',
    });

    const first = await t.query(api.machines.subscribeDaemonOrchestrationIntentsSince, {
      sessionId,
      machineId,
      limit: 50,
    });
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      machineId,
      chatroomId,
      role: 'builder',
      intentType: 'user_message',
    });
    expect(first.highKey).toBe(first.items[0].revisionKey);

    // Replay with the same cursor returns no new intents.
    const replay = await t.query(api.machines.subscribeDaemonOrchestrationIntentsSince, {
      sessionId,
      machineId,
      afterKey: first.highKey ?? undefined,
      limit: 50,
    });
    expect(replay.items).toHaveLength(0);
    expect(replay.highKey).toBeNull();
  });

  test('promoteNextTask creates queued_promotion intent row', async () => {
    const { sessionId } = await createTestSession('p7-queued-promote');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'p7-queued-machine';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    const queuedId = await t.run(async (ctx) =>
      ctx.db.insert('chatroom_messageQueue', {
        chatroomId,
        senderRole: 'user',
        targetRole: 'builder',
        content: 'queued for P7',
        type: 'message',
        queuePosition: 1,
      })
    );

    await t.mutation(api.tasks.promoteSpecificTask, {
      sessionId,
      queuedMessageId: queuedId,
    });

    const intentRows = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_daemonOrchestrationIntents')
        .withIndex('by_machineId_taskId', (q) => q.eq('machineId', machineId))
        .collect()
    );
    expect(intentRows).toHaveLength(1);
    expect(intentRows[0]).toMatchObject({
      machineId,
      chatroomId,
      role: 'builder',
      intentType: 'queued_promotion',
      status: 'pending',
    });
    expect(intentRows[0].revisionKey).toContain(':');
  });

  test('P8: intent is emitted to the orchestration host machine only', async () => {
    const { sessionId } = await createTestSession('p7-intent-host');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const hostMachineId = 'p7-intent-host-machine';
    await registerMachineWithDaemon(sessionId, hostMachineId);
    await registerMachineWithDaemon(sessionId, 'p7-intent-stale-machine');
    await setupRemoteAgentConfig(sessionId, chatroomId, hostMachineId, 'builder');

    // Bind the chatroom to the host machine (P8) and introduce a stale builder
    // config on a second machine (bypassing ensureOnlyAgentForRole).
    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_rooms', chatroomId, {
        orchestrationMachineId: hostMachineId,
        orchestrationWorkingDir: '/test/workspace',
      });
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: `chatroom_${chatroomId}#team_duo#role_builder#stale`,
        chatroomId,
        role: 'builder',
        type: 'remote',
        machineId: 'p7-intent-stale-machine',
        agentHarness: 'opencode',
        workingDir: '/test/workspace',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      type: 'message',
      content: '## Goal\nHost-scoped intent test',
    });

    const intentRows = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_daemonOrchestrationIntents')
        .withIndex('by_machineId_taskId', (q) => q.eq('machineId', hostMachineId))
        .collect()
    );
    expect(intentRows).toHaveLength(1);
    expect(intentRows[0].machineId).toBe(hostMachineId);

    const staleRows = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_daemonOrchestrationIntents')
        .withIndex('by_machineId_taskId', (q) => q.eq('machineId', 'p7-intent-stale-machine'))
        .collect()
    );
    expect(staleRows).toHaveLength(0);
  });
});
