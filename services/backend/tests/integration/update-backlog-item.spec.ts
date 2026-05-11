/**
 * Update Backlog Item — Integration Tests
 *
 * Tests the updateBacklogItem usecase. Verifies that content can be
 * updated on a backlog item in 'backlog' status, and that the Convex
 * API call signature (single arg: just the typed Id) is correct.
 */

import { describe, expect, test } from 'vitest';

import type { Doc, Id } from '../../convex/_generated/dataModel';
import { createBacklogItem } from '../../src/domain/usecase/backlog/create-backlog-item';
import { updateBacklogItem } from '../../src/domain/usecase/backlog/update-backlog-item';
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
      content: 'Original content',
    });
    const item = await ctx.db.get(itemId);
    return item!;
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('updateBacklogItem', () => {
  test('updates content on a backlog item', async () => {
    const { sessionId } = await createTestSession('test-update-backlog-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);
    const item = await createAndFetchBacklogItem(chatroomId);

    await t.run(async (ctx) => {
      await updateBacklogItem(ctx, {
        itemId: item._id,
        content: 'Updated content',
      });
    });

    const updated = await t.run(async (ctx) => {
      return ctx.db.get(item._id);
    });

    expect(updated).toBeDefined();
    expect(updated!.content).toBe('Updated content');
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(item.updatedAt);
  });

  test('trims content whitespace', async () => {
    const { sessionId } = await createTestSession('test-update-backlog-trim');
    const chatroomId = await createPairTeamChatroom(sessionId as any);
    const item = await createAndFetchBacklogItem(chatroomId);

    await t.run(async (ctx) => {
      await updateBacklogItem(ctx, {
        itemId: item._id,
        content: '  trimmed content  ',
      });
    });

    const updated = await t.run(async (ctx) => {
      return ctx.db.get(item._id);
    });

    expect(updated!.content).toBe('trimmed content');
  });

  test('throws when content is empty', async () => {
    const { sessionId } = await createTestSession('test-update-backlog-empty');
    const chatroomId = await createPairTeamChatroom(sessionId as any);
    const item = await createAndFetchBacklogItem(chatroomId);

    await expect(
      t.run(async (ctx) => {
        await updateBacklogItem(ctx, {
          itemId: item._id,
          content: '   ',
        });
      })
    ).rejects.toThrow('Content cannot be empty');
  });

  test('throws when item not found', async () => {
    const { sessionId } = await createTestSession('test-update-backlog-notfound');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    // Create a real item to get a valid ID format, then delete it so we have
    // a non-existent ID in the correct format (Convex validates ID structure).
    const realItemId = await t.run(async (ctx) => {
      const { itemId } = await createBacklogItem(ctx, {
        chatroomId,
        createdBy: 'test-user',
        content: 'temp item',
      });
      return itemId;
    });
    await t.run(async (ctx) => {
      await ctx.db.delete(realItemId);
    });

    await expect(
      t.run(async (ctx) => {
        await updateBacklogItem(ctx, {
          itemId: realItemId,
          content: 'does not matter',
        });
      })
    ).rejects.toThrow('Backlog item not found');
  });
});
