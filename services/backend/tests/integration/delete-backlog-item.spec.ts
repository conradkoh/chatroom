/**
 * Delete Backlog Item — Integration Tests
 *
 * Tests soft-delete of a backlog item while preserving
 * `attachedBacklogItemIds` references on messages.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import { createBacklogItem } from '../../src/domain/usecase/backlog/create-backlog-item';
import { t } from '../../test.setup';
import { createBuilderEntryDuoChatroom, createTestSession } from '../helpers/integration';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createAndFetchBacklogItem(
  chatroomId: Id<'chatroom_rooms'>
): Promise<Doc<'chatroom_backlog'>> {
  return t.run(async (ctx) => {
    const { itemId } = await createBacklogItem(ctx, {
      chatroomId,
      createdBy: 'test',
      content: 'Test backlog item',
    });
    const item = await ctx.db.get('chatroom_backlog', itemId);
    return item!;
  });
}

// ─── Soft delete ─────────────────────────────────────────────────────────────

describe('backlog.deleteBacklogItem', () => {
  test('marks the item deleted and excludes it from the backlog list', async () => {
    const { sessionId } = await createTestSession('test-delete-backlog-1');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId as any);
    const item = await createAndFetchBacklogItem(chatroomId);

    const result = await t.mutation(api.backlog.deleteBacklogItem, {
      sessionId: sessionId as any,
      chatroomId,
      itemId: item._id,
    });
    expect(result.success).toBe(true);

    const fetched = await t.run(async (ctx) => ctx.db.get('chatroom_backlog', item._id));
    expect(fetched?.status).toBe('deleted');

    const items = await t.query(api.backlog.listBacklogItems, {
      sessionId: sessionId as any,
      chatroomId,
      statusFilter: 'backlog',
    });
    expect(items.some((i) => i._id === item._id)).toBe(false);
  });

  test('preserves attachedBacklogItemIds on messages and queued messages', async () => {
    const { sessionId } = await createTestSession('test-delete-backlog-scrub-1');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId as any);
    const item = await createAndFetchBacklogItem(chatroomId);

    const msgId = await t.run(async (ctx) =>
      ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        content: 'test message',
        type: 'message' as const,
        attachedBacklogItemIds: [item._id],
      })
    );
    const queuedId = await t.run(async (ctx) =>
      ctx.db.insert('chatroom_messageQueue', {
        chatroomId,
        senderRole: 'user',
        content: 'test queued',
        type: 'message' as const,
        queuePosition: 1,
        attachedBacklogItemIds: [item._id],
      })
    );

    await t.mutation(api.backlog.deleteBacklogItem, {
      sessionId: sessionId as any,
      chatroomId,
      itemId: item._id,
    });
    const msg = await t.run(async (ctx) =>
      ctx.db.get('chatroom_messages', msgId as Id<'chatroom_messages'>)
    );
    expect(msg?.attachedBacklogItemIds).toEqual([item._id]);

    const queued = await t.run(async (ctx) =>
      ctx.db.get('chatroom_messageQueue', queuedId as Id<'chatroom_messageQueue'>)
    );
    expect(queued?.attachedBacklogItemIds).toEqual([item._id]);
  });
});
