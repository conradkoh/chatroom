/**
 * Stale-context message count cap — Integration Tests
 *
 * `countMessagesSinceCapped` bounds the number of message documents read when
 * computing "messages since context" staleness, instead of `.collect()`-ing
 * every message since the current context. The count therefore saturates at
 * `STALE_CONTEXT_MESSAGE_SAMPLE_LIMIT`.
 *
 * Also pins the read-task fix: `read-task` previously derived this value from
 * the deprecated, never-incremented `chatroom.messageCount`, so it always
 * reported 0. It now uses the bounded scan and reports the real (capped) count.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import {
  countMessagesSinceCapped,
  STALE_CONTEXT_MESSAGE_SAMPLE_LIMIT,
} from '../../src/domain/usecase/context/count-messages-since';
import { t } from '../../test.setup';
import { createTestSession, createDuoTeamChatroom, joinParticipant } from '../helpers/integration';

/** Insert `n` plain messages into a chatroom directly (fast, deterministic). */
async function insertMessages(chatroomId: Id<'chatroom_rooms'>, n: number): Promise<void> {
  await t.run(async (ctx) => {
    for (let i = 0; i < n; i++) {
      await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        content: `m${i}`,
        type: 'message',
      });
    }
  });
}

describe('stale-context message count cap', () => {
  test('returns the exact count when below the sample limit', async () => {
    const { sessionId } = await createTestSession('test-msgcap-exact');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    const before = await t.run((ctx) => countMessagesSinceCapped(ctx, chatroomId, 0));
    await insertMessages(chatroomId, 5);
    const after = await t.run((ctx) => countMessagesSinceCapped(ctx, chatroomId, 0));

    expect(after).toBe(before + 5);
    expect(after).toBeLessThan(STALE_CONTEXT_MESSAGE_SAMPLE_LIMIT);
  });

  test('saturates at the sample limit when messages exceed the cap', async () => {
    const { sessionId } = await createTestSession('test-msgcap-saturate');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    await insertMessages(chatroomId, STALE_CONTEXT_MESSAGE_SAMPLE_LIMIT + 25);
    const count = await t.run((ctx) => countMessagesSinceCapped(ctx, chatroomId, 0));

    expect(count).toBe(STALE_CONTEXT_MESSAGE_SAMPLE_LIMIT);
  });

  test('excludes messages created before the since timestamp', async () => {
    const { sessionId } = await createTestSession('test-msgcap-since');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    await insertMessages(chatroomId, 3);
    const future = Date.now() + 1_000_000;
    const count = await t.run((ctx) => countMessagesSinceCapped(ctx, chatroomId, future));

    expect(count).toBe(0);
  });

  test('read-task reports the bounded messages-since-context (regression: previously always 0)', async () => {
    const { sessionId } = await createTestSession('test-msgcap-readtask');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await joinParticipant(sessionId, chatroomId, 'reviewer');

    // Pin a context (duo entry point = builder).
    await t.mutation(api.contexts.createContext, {
      sessionId,
      chatroomId,
      role: 'builder',
      content: 'Initial context',
    });

    // Activity after the context exists.
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Do the thing',
      type: 'message',
    });

    // Builder claims the resulting task → acknowledged.
    await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });
    const ack = await t.run((ctx) =>
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'acknowledged')
        )
        .first()
    );
    if (!ack) throw new Error('expected an acknowledged task');

    const result = await t.mutation(api.tasks.readTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId: ack._id,
    });

    const context = result.context;
    if (!context) throw new Error('expected a current context on the read-task result');
    expect(context.messagesSinceContext).toBeGreaterThan(0);
    expect(context.messagesSinceContext).toBeLessThanOrEqual(STALE_CONTEXT_MESSAGE_SAMPLE_LIMIT);
  });
});
