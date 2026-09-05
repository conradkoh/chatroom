/**
 * Tests for promote-queued-message use case.
 * Verifies that queued messages are correctly promoted:
 * - message copied from chatroom_messageQueue to chatroom_messages
 * - a new task created with status 'pending'
 * - queue record deleted
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { promoteQueuedMessage } from './promote-queued-message';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { t } from '../../../../test.setup';
import {
  createPlannerBuilderDuoChatroom,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../../../../tests/helpers/integration';
import { getInboxCommandsForChatroom } from '../../../../tests/helpers/machine-command-inbox';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTestSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId, userId: login.userId as Id<'users'> };
}

async function createChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
}

async function createQueueRecord(
  chatroomId: Id<'chatroom_rooms'>,
  content = 'queued message content',
  extra?: {
    sourcePlatform?: string | undefined;
    scheduledPromptId?: Id<'chatroom_scheduledPrompts'> | undefined;
  }
): Promise<Id<'chatroom_messageQueue'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('chatroom_messageQueue', {
      chatroomId,
      senderRole: 'user',
      targetRole: 'planner',
      content,
      type: 'message',
      queuePosition: 1,
      ...(extra?.sourcePlatform ? { sourcePlatform: extra.sourcePlatform } : {}),
      ...(extra?.scheduledPromptId ? { scheduledPromptId: extra.scheduledPromptId } : {}),
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('promoteQueuedMessage', () => {
  test('does not schedule agent restarts when a queued message is promoted', async () => {
    const { sessionId } = await createTestSession('promote-no-restart');
    const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    const machineId = 'machine-promote-no-restart';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    await t.run(async (ctx) => {
      const config = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
        )
        .first();
      expect(config).toBeDefined();
      if (config) await ctx.db.patch(config._id, { desiredState: 'running' });

      const participant = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .first();
      if (participant) {
        await ctx.db.patch(participant._id, { lastStatus: 'agent.exited' });
      } else {
        await ctx.db.insert('chatroom_participants', {
          chatroomId,
          role: 'builder',
          agentType: 'remote',
          lastStatus: 'agent.exited',
          lastDesiredState: 'running',
        });
      }
    });

    const queuedMessageId = await createQueueRecord(chatroomId);
    const result = await t.run((ctx) => promoteQueuedMessage(ctx, queuedMessageId));

    // Promotion still creates the pending task; pickup is assignment-driven
    // (daemon), never presence-driven restarts.
    expect(result?.taskId).toBeDefined();
    const restartCommands = await getInboxCommandsForChatroom(chatroomId, 'agent.restart');
    expect(restartCommands).toHaveLength(0);
  });

  test('creates a chatroom_messages record from queue data', async () => {
    const { sessionId } = await createTestSession('promote-msg-1');
    const chatroomId = await createChatroom(sessionId);

    const queuedMessageId = await createQueueRecord(chatroomId);

    const result = await t.run(async (ctx) => {
      return await promoteQueuedMessage(ctx, queuedMessageId);
    });

    expect(result).toBeDefined();
    expect(result).not.toBeNull();
    expect(result?.messageId).toBeDefined();

    const message = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messages', result!.messageId);
    });

    expect(message).toBeDefined();
    expect(message?.content).toBe('queued message content');
    expect(message?.senderRole).toBe('user');
    expect(message?.targetRole).toBe('planner');
  });

  test('creates a new task with status pending', async () => {
    const { sessionId } = await createTestSession('promote-msg-2');
    const chatroomId = await createChatroom(sessionId);

    const queuedMessageId = await createQueueRecord(chatroomId);

    const result = await t.run(async (ctx) => {
      return await promoteQueuedMessage(ctx, queuedMessageId);
    });

    expect(result?.taskId).toBeDefined();

    const task = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_tasks', result!.taskId);
    });

    expect(task).toBeDefined();
    expect(task?.status).toBe('pending');
    expect(task?.content).toBe('queued message content');
  });

  test('promotes plannerEnhancerEnabled from queue record to task', async () => {
    const { sessionId } = await createTestSession('promote-enh-flag');
    const chatroomId = await createChatroom(sessionId);

    const queuedMessageId = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_messageQueue', {
        chatroomId,
        senderRole: 'user',
        targetRole: 'planner',
        content: 'enhanced task',
        type: 'message',
        queuePosition: 5,
        plannerEnhancerEnabled: true,
      });
    });

    const result = await t.run(async (ctx) => {
      return await promoteQueuedMessage(ctx, queuedMessageId);
    });

    expect(result).toBeDefined();
    const task = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_tasks', result!.taskId);
    });
    expect(task?.plannerEnhancerEnabled).toBe(true);
  });

  test('promotes conversationMode from queue record to task for each explicit mode', async () => {
    const { sessionId } = await createTestSession('promote-conv-mode');
    const chatroomId = await createChatroom(sessionId);

    const modes = ['chat', 'code', 'code:enhanced'] as const;
    for (const mode of modes) {
      const queuedMessageId = await t.run(async (ctx) => {
        return await ctx.db.insert('chatroom_messageQueue', {
          chatroomId,
          senderRole: 'user',
          targetRole: 'planner',
          content: `mode-${mode}`,
          type: 'message',
          queuePosition: 10,
          conversationMode: mode,
          plannerEnhancerEnabled: mode === 'code:enhanced',
        });
      });

      const result = await t.run(async (ctx) => {
        return await promoteQueuedMessage(ctx, queuedMessageId);
      });

      expect(result).toBeDefined();
      const task = await t.run(async (ctx) => {
        return await ctx.db.get('chatroom_tasks', result!.taskId);
      });
      expect(task?.conversationMode).toBe(mode);
      expect(task?.plannerEnhancerEnabled).toBe(mode === 'code:enhanced');
    }
  });

  test('legacy queue row without conversationMode promotes with the derived mode', async () => {
    const { sessionId } = await createTestSession('promote-legacy-row');
    const chatroomId = await createChatroom(sessionId);

    const queuedMessageId = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_messageQueue', {
        chatroomId,
        senderRole: 'user',
        targetRole: 'planner',
        content: 'legacy task',
        type: 'message',
        queuePosition: 11,
        plannerEnhancerEnabled: true,
        // No conversationMode — simulates legacy row
      });
    });

    const result = await t.run(async (ctx) => {
      return await promoteQueuedMessage(ctx, queuedMessageId);
    });

    expect(result).toBeDefined();
    const task = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_tasks', result!.taskId);
    });
    // Canonical persistence derives the mode projection from the normalized
    // envelope (legacy enhancer boolean true → code:enhanced).
    expect(task?.conversationMode).toBe('code:enhanced');
    expect(task?.plannerEnhancerEnabled).toBe(true);
  });

  test('promotes startInNewSession from queue record to task', async () => {
    const { sessionId } = await createTestSession('promote-new-session-flag');
    const chatroomId = await createChatroom(sessionId);
    const queuedMessageId = await t.run(
      async (ctx) =>
        await ctx.db.insert('chatroom_messageQueue', {
          chatroomId,
          senderRole: 'user',
          targetRole: 'planner',
          content: 'cold-start task',
          type: 'message',
          queuePosition: 6,
          startInNewSession: true,
        })
    );

    const result = await t.run(async (ctx) => promoteQueuedMessage(ctx, queuedMessageId));
    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', result!.taskId));

    expect(task?.startInNewSession).toBe(true);
  });

  test('sets assignedTo to team entry point', async () => {
    const { sessionId } = await createTestSession('promote-msg-assigned');
    const chatroomId = await createChatroom(sessionId);

    const queuedMessageId = await createQueueRecord(chatroomId);

    const result = await t.run(async (ctx) => {
      return await promoteQueuedMessage(ctx, queuedMessageId);
    });

    const task = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_tasks', result!.taskId);
    });

    expect(task?.assignedTo).toBe('planner');
  });

  test('links message and task bidirectionally', async () => {
    const { sessionId } = await createTestSession('promote-msg-3');
    const chatroomId = await createChatroom(sessionId);

    const queuedMessageId = await createQueueRecord(chatroomId);

    const result = await t.run(async (ctx) => {
      return await promoteQueuedMessage(ctx, queuedMessageId);
    });

    const message = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messages', result!.messageId);
    });
    const task = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_tasks', result!.taskId);
    });

    expect(message?.taskId).toBe(result!.taskId);
    expect(task?.sourceMessageId).toBe(result!.messageId);
  });

  test('deletes queue record after successful promotion', async () => {
    const { sessionId } = await createTestSession('promote-msg-4');
    const chatroomId = await createChatroom(sessionId);

    const queuedMessageId = await createQueueRecord(chatroomId);

    // Verify queue record exists before promotion
    const queueRecordBefore = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messageQueue', queuedMessageId);
    });
    expect(queueRecordBefore).toBeDefined();

    // Promote
    await t.run(async (ctx) => {
      return await promoteQueuedMessage(ctx, queuedMessageId);
    });

    // Verify queue record is deleted
    const queueRecordAfter = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messageQueue', queuedMessageId);
    });
    expect(queueRecordAfter).toBeNull();
  });

  test('propagates sourcePlatform from queue record to promoted message', async () => {
    const { sessionId } = await createTestSession('promote-source-platform');
    const chatroomId = await createChatroom(sessionId);

    const queuedMessageId = await createQueueRecord(chatroomId, 'scheduled msg', {
      sourcePlatform: 'scheduled',
    });

    const result = await t.run(async (ctx) => {
      return await promoteQueuedMessage(ctx, queuedMessageId);
    });

    expect(result).toBeDefined();
    const message = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messages', result!.messageId);
    });
    expect(message?.sourcePlatform).toBe('scheduled');
  });

  test('propagates scheduledPromptId from queue record to promoted message', async () => {
    const { sessionId, userId } = await createTestSession('promote-sp-id');
    const chatroomId = await createChatroom(sessionId);

    const promptId = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'test',
        scheduleKind: 'interval',
        intervalMinutes: 30,
        disabledReason: undefined,
        isRunnable: true,
        createdBy: userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const queuedMessageId = await createQueueRecord(chatroomId, 'scheduled msg', {
      scheduledPromptId: promptId as Id<'chatroom_scheduledPrompts'>,
    });

    const result = await t.run(async (ctx) => {
      return await promoteQueuedMessage(ctx, queuedMessageId);
    });

    expect(result).toBeDefined();
    const message = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messages', result!.messageId);
    });
    expect(message?.scheduledPromptId).toBe(promptId);
  });

  test('returns null if queue record does not exist', async () => {
    const { sessionId } = await createTestSession('promote-msg-5');
    const chatroomId = await createChatroom(sessionId);

    // Create a queue record, then delete it so we have a valid-format ID that no longer exists
    const deletedId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('chatroom_messageQueue', {
        chatroomId,
        senderRole: 'user',
        targetRole: 'planner',
        content: 'temp',
        type: 'message',
        queuePosition: 0,
      });
      await ctx.db.delete('chatroom_messageQueue', id);
      return id;
    });

    const result = await t.run(async (ctx) => {
      return await promoteQueuedMessage(ctx, deletedId);
    });

    expect(result).toBeNull();
  });
});

describe('promoteQueuedMessage — TaskEnvelopeV1', () => {
  test('copies an explicit queue envelope intact to the promoted task', async () => {
    const { sessionId } = await createTestSession('promote-env-explicit');
    const chatroomId = await createChatroom(sessionId);

    const explicitEnvelope = {
      version: 1 as const,
      conversationMode: 'code' as const,
      sessionPolicy: 'new' as const,
      handoffWorkflow: { preset: 'team' as const, phase: 'implementation' as const },
    };
    const queuedMessageId = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_messageQueue', {
        chatroomId,
        senderRole: 'user',
        targetRole: 'planner',
        content: 'explicit envelope task',
        type: 'message',
        queuePosition: 20,
        taskEnvelope: explicitEnvelope,
      });
    });

    const result = await t.run(async (ctx) => {
      return await promoteQueuedMessage(ctx, queuedMessageId);
    });

    expect(result).toBeDefined();
    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', result!.taskId));
    // The full snapshot is copied, including session policy and workflow phase.
    expect(task?.taskEnvelope).toEqual(explicitEnvelope);
    expect(task?.taskEnvelope?.sessionPolicy).toBe('new');
    expect(task?.taskEnvelope?.handoffWorkflow).toEqual({
      preset: 'team',
      phase: 'implementation',
    });
  });

  test('normalizes a legacy queue row without taskEnvelope into a complete envelope on the task', async () => {
    const { sessionId } = await createTestSession('promote-env-legacy');
    const chatroomId = await createChatroom(sessionId);

    const queuedMessageId = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_messageQueue', {
        chatroomId,
        senderRole: 'user',
        targetRole: 'planner',
        content: 'legacy envelope task',
        type: 'message',
        queuePosition: 21,
        conversationMode: 'chat',
        plannerEnhancerEnabled: false,
      });
    });

    const result = await t.run(async (ctx) => {
      return await promoteQueuedMessage(ctx, queuedMessageId);
    });

    expect(result).toBeDefined();
    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', result!.taskId));
    expect(task?.taskEnvelope).toEqual({
      version: 1,
      conversationMode: 'chat',
      sessionPolicy: 'continue',
      handoffWorkflow: { preset: 'direct', phase: 'entry' },
    });
    // Temporary scalar projections are preserved for existing readers.
    expect(task?.conversationMode).toBe('chat');
    expect(task?.plannerEnhancerEnabled).toBe(false);
  });

  test('legacy enhancer-scalar rows keep scalar expectations alongside the complete envelope', async () => {
    const { sessionId } = await createTestSession('promote-env-enh-scalar');
    const chatroomId = await createChatroom(sessionId);

    const queuedMessageId = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_messageQueue', {
        chatroomId,
        senderRole: 'user',
        targetRole: 'planner',
        content: 'enh scalar task',
        type: 'message',
        queuePosition: 22,
        plannerEnhancerEnabled: true,
        startInNewSession: true,
      });
    });

    const result = await t.run(async (ctx) => {
      return await promoteQueuedMessage(ctx, queuedMessageId);
    });

    expect(result).toBeDefined();
    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', result!.taskId));
    // Normalized from the enhancer boolean → code:enhanced; session from the flag.
    expect(task?.taskEnvelope).toEqual({
      version: 1,
      conversationMode: 'code:enhanced',
      sessionPolicy: 'new',
      handoffWorkflow: { preset: 'enhanced-team', phase: 'entry' },
    });
    // Existing scalar expectations stay canonical: all projections derive from
    // the complete envelope (code:enhanced/new).
    expect(task?.plannerEnhancerEnabled).toBe(true);
    expect(task?.startInNewSession).toBe(true);
    expect(task?.conversationMode).toBe('code:enhanced');
  });
});
