/**
 * groundings — Integration Tests
 *
 * Drives the real convex-test harness end to end: `groundings.publish` validates
 * and stores a `type: 'grounding'` message (plus its timeline read-model row)
 * with no room/unread side effects, and `groundings.get` reads it back or
 * rejects ids that are malformed, not a grounding, or in another chatroom.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  createPlannerBuilderDuoChatroom,
  createTestSession,
  joinParticipant,
} from '../helpers/integration';

const GROUNDING_MARKDOWN = [
  '# Grounding: Add grounding messages',
  '',
  '## Request',
  '- Add grounding messages to the handoff flow. (source: jd753kwhvfehdf89ta93zyntnh8jxa39)',
  '',
  '## Relevant files',
  '- `services/backend/convex/plans.ts` — plan publish and read functions, as observed.',
  '',
  '## Entry points',
  '- `publish` in `services/backend/convex/plans.ts` — mutation called by the CLI, as observed.',
  '',
  '## Flow',
  '```mermaid',
  'sequenceDiagram',
  '  CLI->>plans: publish',
  '```',
  '',
  '## Prior records',
  '- None observed.',
  '',
  '## Not inspected',
  '- None observed.',
].join('\n');

/** A valid plan document, matching the shape `plan.spec.ts` publishes. */
function makePlanMarkdown(): string {
  return [
    '# Integration test plan',
    '',
    '## Sources',
    '- test-source',
    '',
    '## Requirements',
    '- Requirement one.',
    '',
    '## Constraints',
    '- None.',
    '',
    '## Phases',
    '- P1 — Phase 1',
    '',
    '## Phase details',
    '',
    '### P1 — Phase 1',
    '',
    '#### Requirements',
    '- Phase 1 requirement.',
    '',
    '#### Constraints',
    '- None.',
    '',
    '#### Acceptance criteria',
    '- Phase 1 acceptance.',
    '',
    '## Remarks',
    'Test plan.',
  ].join('\n');
}

/** Seed a user-origin message plus its task, and return both IDs. */
async function seedUserOriginTask(
  chatroomId: Id<'chatroom_rooms'>,
  content: string,
  assignedTo: string,
  status: 'pending' | 'acknowledged' | 'in_progress'
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
      status,
      assignedTo,
      sourceMessageId: userMessageId,
      createdAt: now,
      updatedAt: now,
      queuePosition: 1,
    });
    return { userMessageId, taskId };
  });
}

async function countGroundings(chatroomId: Id<'chatroom_rooms'>): Promise<number> {
  return await t.run(async (ctx) => {
    const rows = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
    return rows.filter((row) => row.type === 'grounding').length;
  });
}

async function readUnreadStatus(chatroomId: Id<'chatroom_rooms'>) {
  return await t.run(async (ctx) => {
    const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
    return await ctx.db
      .query('chatroom_unreadStatus')
      .withIndex('by_userId_chatroomId', (q) =>
        q.eq('userId', chatroom!.ownerId!).eq('chatroomId', chatroomId)
      )
      .first();
  });
}

/** Set up a duo chatroom with both participants joined and a builder task. */
async function setupActiveBuilder(sessionId: SessionId) {
  const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
  await joinParticipant(sessionId, chatroomId, 'planner');
  await joinParticipant(sessionId, chatroomId, 'builder');
  const { taskId } = await seedUserOriginTask(
    chatroomId,
    'Grounding work',
    'builder',
    'in_progress'
  );
  return { chatroomId, taskId };
}

describe('groundings', () => {
  test('publish stores a validated grounding with no room or unread side effects', async () => {
    const { sessionId } = await createTestSession('grounding-publish');
    const { chatroomId } = await setupActiveBuilder(sessionId);
    // Trailing whitespace proves the stored content is `trimEnd()`ed.
    const content = `${GROUNDING_MARKDOWN}\n\n`;

    const before = await t.run(async (ctx) => {
      const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
      return { lastActivityAt: chatroom!.lastActivityAt };
    });
    const unreadBefore = await readUnreadStatus(chatroomId);

    const result = await t.mutation(api.groundings.publish, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content,
    });

    expect(result.groundingId).toBe(result.messageId);

    const stored = await t.run((ctx) => ctx.db.get('chatroom_messages', result.messageId));
    expect(stored).not.toBeNull();
    expect(stored!.type).toBe('grounding');
    expect(stored!.senderRole).toBe('builder');
    expect(stored!.content).toBe(GROUNDING_MARKDOWN);
    expect(stored!.targetRole).toBeUndefined();
    expect(stored!.taskId).toBeUndefined();

    const readModel = await t.run((ctx) =>
      ctx.db
        .query('chatroom_messageReadModels')
        .withIndex('by_messageId', (q) => q.eq('messageId', result.messageId))
        .first()
    );
    expect(readModel).not.toBeNull();
    expect(readModel!.type).toBe('grounding');
    expect(readModel!.isTimeline).toBe(true);

    const after = await t.run(async (ctx) => {
      const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
      return { lastActivityAt: chatroom!.lastActivityAt };
    });
    expect(after.lastActivityAt).toBe(before.lastActivityAt);
    expect(await readUnreadStatus(chatroomId)).toEqual(unreadBefore);
  });

  test('rejections store no grounding row', async () => {
    const { sessionId } = await createTestSession('grounding-rejections');
    const { chatroomId } = await setupActiveBuilder(sessionId);

    await expect(
      t.mutation(api.groundings.publish, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: GROUNDING_MARKDOWN,
      })
    ).rejects.toMatchObject({ data: { code: 'INVALID_ROLE' } });

    await expect(
      t.mutation(api.groundings.publish, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: '   ',
      })
    ).rejects.toMatchObject({ data: { code: 'EMPTY_CONTENT' } });

    const error = await t
      .mutation(api.groundings.publish, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: GROUNDING_MARKDOWN.replace('\n## Not inspected\n- None observed.', ''),
      })
      .catch((thrown: { data?: { code?: string; errors?: { code: string }[] } }) => thrown);
    expect(error.data?.code).toBe('INVALID_GROUNDING');
    expect(error.data?.errors?.map((entry) => entry.code)).toContain('GROUNDING_SECTION_MISSING');

    await expect(
      t.mutation(api.groundings.publish, {
        sessionId,
        chatroomId,
        senderRole: 'planner',
        content: GROUNDING_MARKDOWN,
      })
    ).rejects.toMatchObject({ data: { code: 'NO_ACTIVE_TASK' } });

    expect(await countGroundings(chatroomId)).toBe(0);
  });

  test('get returns the stored content, sender and id', async () => {
    const { sessionId } = await createTestSession('grounding-get');
    const { chatroomId } = await setupActiveBuilder(sessionId);
    const published = await t.mutation(api.groundings.publish, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: GROUNDING_MARKDOWN,
    });

    const got = await t.query(api.groundings.get, {
      sessionId,
      chatroomId,
      groundingId: published.groundingId,
    });
    expect(got.groundingId).toBe(published.groundingId);
    expect(got.senderRole).toBe('builder');
    expect(got.content).toBe(GROUNDING_MARKDOWN);
    expect(typeof got.createdAt).toBe('number');
  });

  test('get rejects malformed, plan and other-room ids', async () => {
    const { sessionId } = await createTestSession('grounding-not-found');
    const { chatroomId } = await setupActiveBuilder(sessionId);

    const plan = await t.mutation(api.plans.publish, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: makePlanMarkdown(),
    });

    const other = await setupActiveBuilder(sessionId);
    const foreign = await t.mutation(api.groundings.publish, {
      sessionId,
      chatroomId: other.chatroomId,
      senderRole: 'builder',
      content: GROUNDING_MARKDOWN,
    });

    for (const groundingId of ['not-an-id', plan.planId, foreign.groundingId]) {
      await expect(
        t.query(api.groundings.get, { sessionId, chatroomId, groundingId })
      ).rejects.toMatchObject({ data: { code: 'GROUNDING_NOT_FOUND' } });
    }
  });
});
