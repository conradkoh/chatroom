/**
 * Grounding round trip — Integration Tests
 *
 * Proves the published grounding template survives the whole prompt path: the
 * exact `view-template` skeleton (with its placeholders filled) validates and
 * publishes through convex-test, and the trio handoff reference hands the real
 * grounding id to the recipient, which reads the same content back.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { viewGroundingTemplate } from '../../prompts/cli/grounding/view-template';
import { renderHandoffTemplate } from '../../prompts/cli/handoff-templates';
import { validateGrounding } from '../../src/domain/grounding/validate-grounding';
import { t } from '../../test.setup';
import { createTestSession, joinParticipant } from '../helpers/integration';

/** Create a trio chatroom and join its three permanent roles. */
async function createTrioChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  const chatroomId = await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'trio',
  });
  await joinParticipant(sessionId, chatroomId, 'coordinator');
  await joinParticipant(sessionId, chatroomId, 'specifier');
  await joinParticipant(sessionId, chatroomId, 'builder');
  return chatroomId;
}

/** Seed a user-origin message plus an in-progress task assigned to `assignedTo`. */
async function seedActiveTask(
  chatroomId: Id<'chatroom_rooms'>,
  content: string,
  assignedTo: string
): Promise<{ userMessageId: Id<'chatroom_messages'>; taskId: Id<'chatroom_tasks'> }> {
  return await t.run(async (ctx) => {
    const userMessageId = await ctx.db.insert('chatroom_messages', {
      chatroomId,
      senderRole: 'user',
      content,
      targetRole: assignedTo,
      type: 'message',
      acknowledgedAt: Date.now(),
    });
    const now = Date.now();
    const taskId = await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content,
      status: 'in_progress',
      assignedTo,
      sourceMessageId: userMessageId,
      createdAt: now,
      updatedAt: now,
      queuePosition: 1,
    });
    return { userMessageId, taskId };
  });
}

/** The filled skeleton: every `<placeholder>` replaced with a literal token. */
function fillTemplate(): string {
  const skeleton = viewGroundingTemplate().split('\n\nRules for this document:')[0];
  return skeleton.replace(/<[^>]*>/g, 'filled');
}

/**
 * The fenced `## Grounding` section of a rendered handoff, with the real id
 * substituted for the placeholder.
 */
function substituteGroundingId(rendered: string, groundingId: string): string {
  const lines = rendered.split('\n');
  const start = lines.indexOf('## Grounding');
  expect(start).toBeGreaterThanOrEqual(0);
  const closingFence = lines.indexOf('```', start + 1);
  expect(closingFence).toBeGreaterThan(start);
  return lines.slice(start, closingFence).join('\n').replaceAll('<groundingId>', groundingId);
}

describe('grounding round trip', () => {
  test('the filled view-template publishes, and the handoff reference round-trips its id', async () => {
    const { sessionId } = await createTestSession('grounding-round-trip');
    const chatroomId = await createTrioChatroom(sessionId);
    await seedActiveTask(chatroomId, 'Grounding work', 'coordinator');

    const filled = fillTemplate();
    expect(validateGrounding(filled).ok).toBe(true);

    const published = await t.mutation(api.groundings.publish, {
      sessionId,
      chatroomId,
      senderRole: 'coordinator',
      content: filled,
    });
    const groundingId = published.groundingId;

    const readBack = await t.query(api.groundings.get, {
      sessionId,
      chatroomId,
      groundingId,
    });
    expect(readBack.content).toBe(filled.trimEnd());

    const readModel = await t.run((ctx) =>
      ctx.db
        .query('chatroom_messageReadModels')
        .withIndex('by_messageId', (q) => q.eq('messageId', published.messageId))
        .first()
    );
    expect(readModel).not.toBeNull();
    expect(readModel!.isTimeline).toBe(true);

    const rendered = renderHandoffTemplate(
      { teamId: 'trio', fromRole: 'coordinator', toRole: 'architect' },
      { chatroomId, cliEnvPrefix: '', conversationMode: 'code' }
    );
    expect(rendered).not.toBeNull();
    expect(rendered).toContain('## Grounding');

    const section = substituteGroundingId(rendered as string, groundingId);
    const match = section.match(/Grounding ID: (\S+?),/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe(groundingId);

    const referenced = await t.query(api.groundings.get, {
      sessionId,
      chatroomId,
      groundingId: match![1],
    });
    expect(referenced.content).toBe(filled.trimEnd());
  });
});
