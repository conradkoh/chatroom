/**
 * Standing Instructions — Integration Tests
 *
 * Covers `updateHistory` propagation (`applyToOwnerChatrooms`) and the
 * synthetic-current `clear` path.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { createBuilderEntryDuoChatroom, createTestSession } from '../helpers/integration';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function setupRoomWithInstructions(
  sessionId: string,
  content: string,
  title: string
): Promise<Id<'chatroom_rooms'>> {
  const chatroomId = await createBuilderEntryDuoChatroom(sessionId as any);
  await t.mutation(api.standingInstructions.upsert, { sessionId, chatroomId, content, title });
  return chatroomId;
}

async function findHistoryId(
  sessionId: string,
  content: string
): Promise<Id<'chatroom_standingInstructionHistory'>> {
  const history = await t.query(api.standingInstructions.listHistory, { sessionId });
  const row = history.find((h) => h.content === content);
  if (!row) throw new Error(`No history row with content ${content}`);
  return row._id;
}

async function getRoom(chatroomId: Id<'chatroom_rooms'>) {
  return t.run(async (ctx) => ctx.db.get(chatroomId));
}

// ─── updateHistory propagation ────────────────────────────────────────────────

describe('standingInstructions.updateHistory — applyToOwnerChatrooms', () => {
  test('propagates the update to every owned chatroom with a matching contentKey', async () => {
    const { sessionId } = await createTestSession('test-si-propagate-1');
    const roomA = await setupRoomWithInstructions(sessionId, 'Rule A', 'T1');
    const roomB = await setupRoomWithInstructions(sessionId, 'Rule A', 'T2');
    const historyId = await findHistoryId(sessionId, 'Rule A');

    await t.mutation(api.standingInstructions.updateHistory, {
      sessionId,
      historyId,
      content: 'Rule B',
      title: 'Updated',
      applyToOwnerChatrooms: true,
    });

    const a = await getRoom(roomA);
    const b = await getRoom(roomB);
    expect(a?.standingInstructions).toBe('Rule B');
    expect(a?.standingInstructionsTitle).toBe('Updated');
    expect(b?.standingInstructions).toBe('Rule B');
    expect(b?.standingInstructionsTitle).toBe('Updated');
  });

  test('leaves owned chatrooms with different content untouched', async () => {
    const { sessionId } = await createTestSession('test-si-propagate-2');
    const roomA = await setupRoomWithInstructions(sessionId, 'Rule A', 'T1');
    const roomC = await setupRoomWithInstructions(sessionId, 'Different', 'T3');
    const historyId = await findHistoryId(sessionId, 'Rule A');

    await t.mutation(api.standingInstructions.updateHistory, {
      sessionId,
      historyId,
      content: 'Rule B',
      title: 'Updated',
      applyToOwnerChatrooms: true,
    });

    const a = await getRoom(roomA);
    const c = await getRoom(roomC);
    expect(a?.standingInstructions).toBe('Rule B');
    expect(c?.standingInstructions).toBe('Different');
  });

  test('omitting applyToOwnerChatrooms leaves all rooms untouched', async () => {
    const { sessionId } = await createTestSession('test-si-propagate-3');
    const roomA = await setupRoomWithInstructions(sessionId, 'Rule A', 'T1');
    const roomB = await setupRoomWithInstructions(sessionId, 'Rule A', 'T2');
    const historyId = await findHistoryId(sessionId, 'Rule A');

    await t.mutation(api.standingInstructions.updateHistory, {
      sessionId,
      historyId,
      content: 'Rule B',
      title: 'Updated',
    });

    // Only the history row is updated — the current chatroom is handled by the
    // separate upsert in the frontend flow, and other rooms are untouched.
    const a = await getRoom(roomA);
    const b = await getRoom(roomB);
    expect(a?.standingInstructions).toBe('Rule A');
    expect(b?.standingInstructions).toBe('Rule A');
  });

  test('preserves standingInstructionsEnabled on propagated rooms', async () => {
    const { sessionId } = await createTestSession('test-si-propagate-4');
    const roomA = await setupRoomWithInstructions(sessionId, 'Rule A', 'T1');
    await t.mutation(api.standingInstructions.setEnabled, {
      sessionId,
      chatroomId: roomA,
      enabled: false,
    });
    const historyId = await findHistoryId(sessionId, 'Rule A');

    await t.mutation(api.standingInstructions.updateHistory, {
      sessionId,
      historyId,
      content: 'Rule B',
      title: 'Updated',
      applyToOwnerChatrooms: true,
    });

    const a = await getRoom(roomA);
    expect(a?.standingInstructions).toBe('Rule B');
    // Disabled flag preserved — propagation only patches content + title.
    expect(a?.standingInstructionsEnabled).toBe(false);
  });
});

// ─── Synthetic clear path ─────────────────────────────────────────────────────

describe('standingInstructions.clear — synthetic delete', () => {
  test('empties and disables the room standing instructions', async () => {
    const { sessionId } = await createTestSession('test-si-clear-1');
    const roomId = await setupRoomWithInstructions(sessionId, 'Rule A', 'T1');

    await t.mutation(api.standingInstructions.clear, { sessionId, chatroomId: roomId });

    const room = await getRoom(roomId);
    expect(room?.standingInstructions).toBe('');
    expect(room?.standingInstructionsEnabled).toBe(false);
    expect(room?.standingInstructionsTitle).toBeUndefined();
  });
});
