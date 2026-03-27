/**
 * Close Backlog Item — Integration Tests
 *
 * Tests the closeBacklogItem usecase, including idempotent behavior
 * when attempting to close an already-closed item.
 */

import { describe, expect, test } from 'vitest';

import type { Doc, Id } from '../../convex/_generated/dataModel';
import { closeBacklogItem } from '../../src/domain/usecase/backlog/close-backlog-item';
import { createBacklogItem } from '../../src/domain/usecase/backlog/create-backlog-item';
import { t } from '../../test.setup';
import { createPairTeamChatroom, createTestSession } from '../helpers/integration';

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

// ─── Close from backlog status ────────────────────────────────────────────────

describe('closeBacklogItem', () => {
  test('closes a backlog item from backlog status', async () => {
    const { sessionId } = await createTestSession('test-close-backlog-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);
    const item = await createAndFetchBacklogItem(chatroomId);

    await t.run(async (ctx) => {
      await closeBacklogItem(ctx, item, { reason: 'No longer needed' });
    });

    // Verify item is now closed
    const updated = await t.run(async (ctx) => {
      return ctx.db.get('chatroom_backlog', item._id);
    });
    expect(updated).toBeDefined();
    expect(updated!.status).toBe('closed');
    expect(updated!.closeReason).toBe('No longer needed');
  });

  // ─── Idempotent close ────────────────────────────────────────────────────────

  test('is a no-op when item is already closed (idempotent)', async () => {
    const { sessionId } = await createTestSession('test-close-backlog-idem-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);
    const item = await createAndFetchBacklogItem(chatroomId);

    // Close the item the first time
    await t.run(async (ctx) => {
      await closeBacklogItem(ctx, item, { reason: 'First close' });
    });

    // Verify it is closed
    const itemAfterFirstClose = await t.run(async (ctx) => {
      return ctx.db.get('chatroom_backlog', item._id);
    });
    expect(itemAfterFirstClose!.status).toBe('closed');

    // Close again with the already-closed item — should NOT throw
    await t.run(async (ctx) => {
      await closeBacklogItem(ctx, itemAfterFirstClose!, { reason: 'Second close' });
    });

    // Verify item is still closed and unchanged (no-op, original reason preserved)
    const itemAfterSecondClose = await t.run(async (ctx) => {
      return ctx.db.get('chatroom_backlog', item._id);
    });
    expect(itemAfterSecondClose!.status).toBe('closed');
    expect(itemAfterSecondClose!.closeReason).toBe('First close');
  });

  test('skips transition when passed an already-closed item directly', async () => {
    const { sessionId } = await createTestSession('test-close-backlog-preclosed');
    const chatroomId = await createPairTeamChatroom(sessionId as any);
    const item = await createAndFetchBacklogItem(chatroomId);

    // Close the item via the FSM first
    await t.run(async (ctx) => {
      await closeBacklogItem(ctx, item, { reason: 'Initial close' });
    });

    // Fetch the closed item
    const closedItem = await t.run(async (ctx) => {
      return ctx.db.get('chatroom_backlog', item._id);
    });

    // Pass the closed item directly — should be a no-op without touching the DB
    await t.run(async (ctx) => {
      await closeBacklogItem(ctx, closedItem!, { reason: 'Should be ignored' });
    });

    // Verify nothing changed
    const finalItem = await t.run(async (ctx) => {
      return ctx.db.get('chatroom_backlog', item._id);
    });
    expect(finalItem!.status).toBe('closed');
    expect(finalItem!.closeReason).toBe('Initial close');
  });
});
