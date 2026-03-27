/**
 * Close Backlog Item — Integration Tests
 *
 * Tests the closeBacklogItem usecase, including idempotent behavior
 * when attempting to close an already-closed item.
 */

import { describe, expect, test } from 'vitest';

import type { Id } from '../../convex/_generated/dataModel';
import { InvalidBacklogTransitionError } from '../../convex/lib/backlogStateMachine';
import { closeBacklogItem } from '../../src/domain/usecase/backlog/close-backlog-item';
import { createBacklogItem } from '../../src/domain/usecase/backlog/create-backlog-item';
import { t } from '../../test.setup';
import { createPairTeamChatroom, createTestSession } from '../helpers/integration';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createTestBacklogItem(chatroomId: Id<'chatroom_rooms'>): Promise<Id<'chatroom_backlog'>> {
  return t.run(async (ctx) => {
    const { itemId } = await createBacklogItem(ctx, {
      chatroomId,
      createdBy: 'test',
      content: 'Test backlog item',
    });
    return itemId;
  });
}

// ─── Close from backlog status ────────────────────────────────────────────────

describe('closeBacklogItem', () => {
  test('closes a backlog item from backlog status', async () => {
    const { sessionId } = await createTestSession('test-close-backlog-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);
    const itemId = await createTestBacklogItem(chatroomId);

    await t.run(async (ctx) => {
      await closeBacklogItem(ctx, itemId, { reason: 'No longer needed' });
    });

    // Verify item is now closed
    const item = await t.run(async (ctx) => {
      return ctx.db.get('chatroom_backlog', itemId);
    });
    expect(item).toBeDefined();
    expect(item!.status).toBe('closed');
    expect(item!.closeReason).toBe('No longer needed');
  });

  // ─── Idempotent close ────────────────────────────────────────────────────────

  test('is a no-op when item is already closed (idempotent)', async () => {
    const { sessionId } = await createTestSession('test-close-backlog-idem-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);
    const itemId = await createTestBacklogItem(chatroomId);

    // Close the item the first time
    await t.run(async (ctx) => {
      await closeBacklogItem(ctx, itemId, { reason: 'First close' });
    });

    // Verify it is closed
    const itemAfterFirstClose = await t.run(async (ctx) => {
      return ctx.db.get('chatroom_backlog', itemId);
    });
    expect(itemAfterFirstClose!.status).toBe('closed');

    // Close again — should NOT throw
    await t.run(async (ctx) => {
      await closeBacklogItem(ctx, itemId, { reason: 'Second close' });
    });

    // Verify item is still closed and unchanged (no-op, original reason preserved)
    const itemAfterSecondClose = await t.run(async (ctx) => {
      return ctx.db.get('chatroom_backlog', itemId);
    });
    expect(itemAfterSecondClose!.status).toBe('closed');
    expect(itemAfterSecondClose!.closeReason).toBe('First close');
  });

  test('throws when item does not exist', async () => {
    const { sessionId } = await createTestSession('test-close-backlog-notfound');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    // Create an item and then delete it to get a valid but non-existent ID
    const itemId = await t.run(async (ctx) => {
      const { itemId } = await createBacklogItem(ctx, {
        chatroomId,
        createdBy: 'test',
        content: 'Will be deleted',
      });
      await ctx.db.delete('chatroom_backlog', itemId);
      return itemId;
    });

    await expect(
      t.run(async (ctx) => {
        await closeBacklogItem(ctx, itemId, { reason: 'Should fail' });
      })
    ).rejects.toThrow('not found');
  });
});
