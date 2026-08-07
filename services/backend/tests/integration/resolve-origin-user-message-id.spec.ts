/**
 * resolve-origin-user-message-id — Integration Tests
 *
 * Verifies walkToUserMessageId can resolve direct and follow-up user messages.
 */

import { describe, expect, test } from 'vitest';

import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { setupWorkspaceForSession } from './direct-harness/fixtures';
import { walkToUserMessageId } from '../../src/domain/usecase/enhancer/resolve-origin-user-message-id';

describe('resolve-origin-user-message-id', () => {
  test('resolves direct user message from planner task sourceMessageId', async () => {
    const { chatroomId } = await setupWorkspaceForSession('resolve-origin');

    const msgId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('chatroom_messages', {
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
        sourceMessageId: id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        queuePosition: 1,
      });
      return id;
    });

    const resolved = await t.run(async (ctx) => walkToUserMessageId(ctx, msgId));
    expect(resolved).toBe(msgId);
  });

  test('resolves origin user message through follow-up chain', async () => {
    const { chatroomId } = await setupWorkspaceForSession('resolve-followup');

    const originMsgId = await t.run(async (ctx) => {
      // Create origin user message
      const originId = await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        content: 'Original user request',
        targetRole: 'planner',
        type: 'message',
      });

      // Create follow-up message with taskOriginMessageId pointing to origin
      const followUpId = await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'planner',
        content: 'Follow-up from planner',
        targetRole: 'enhancer',
        type: 'handoff',
        taskOriginMessageId: originId,
      });

      return { originId, followUpId };
    });

    // Walking from follow-up should resolve to origin
    const resolved = await t.run(async (ctx) => walkToUserMessageId(ctx, originMsgId.followUpId));
    expect(resolved).toBe(originMsgId.originId);
  });

  test('returns null for non-user message without taskOriginMessageId', async () => {
    const { chatroomId } = await setupWorkspaceForSession('resolve-null');

    const msgId = await t.run(async (ctx) =>
      ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'planner',
        content: 'Planner check-in',
        targetRole: 'enhancer',
        type: 'handoff',
      })
    );

    const resolved = await t.run(async (ctx) => walkToUserMessageId(ctx, msgId));
    expect(resolved).toBeNull();
  });

  test('resolves origin through builder handback with taskOriginMessageId', async () => {
    const { chatroomId } = await setupWorkspaceForSession('resolve-builder-handback');

    const userMsgId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        content: 'Original request',
        targetRole: 'planner',
        type: 'message',
      });
      await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'Original request',
        status: 'completed',
        assignedTo: 'planner',
        sourceMessageId: id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        queuePosition: 1,
      });
      return id;
    });

    // Insert a builder handback message with taskOriginMessageId pointing to the user message
    const handbackMsgId = await t.run(async (ctx) =>
      ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'builder',
        content: 'Slice complete',
        targetRole: 'planner',
        type: 'handoff',
        taskOriginMessageId: userMsgId,
      })
    );

    // Walking from a task whose sourceMessageId is the handback should resolve to user message
    const resolved = await t.run(async (ctx) => walkToUserMessageId(ctx, handbackMsgId));
    expect(resolved).toBe(userMsgId);
  });
});
