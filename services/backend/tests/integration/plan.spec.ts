/**
 * plans — Integration Tests
 *
 * Drives the real convex-test harness end to end: `plans.publish` validates and
 * stores a `type: 'plan'` message (plus its timeline read-model row) with no
 * room/unread side effects, `plans.get` reads it back, and the shared parser
 * renders a single phase for the CLI contract.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { parsePlan } from '../../src/domain/plan/parse-plan';
import { renderPlanPhase } from '../../src/domain/plan/render-plan-phase';
import { t } from '../../test.setup';
import {
  createPlannerBuilderDuoChatroom,
  createTestSession,
  joinParticipant,
} from '../helpers/integration';

/** Build a valid plan document with `phaseCount` sequential phases. */
function makePlanMarkdown(phaseCount = 2): string {
  const lines: string[] = [
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
  ];
  for (let index = 1; index <= phaseCount; index++) {
    lines.push(`- P${index} — Phase ${index}`);
  }
  lines.push('', '## Phase details');
  for (let index = 1; index <= phaseCount; index++) {
    lines.push('', `### P${index} — Phase ${index}`, '');
    if (index > 1) lines.push('#### Depends on', `- P${index - 1}`, '');
    lines.push(
      '#### Requirements',
      `- Phase ${index} requirement.`,
      '',
      '#### Constraints',
      '- None.',
      '',
      '#### Acceptance criteria',
      `- Phase ${index} acceptance.`
    );
  }
  lines.push('', '## Remarks', 'Test plan.');
  return lines.join('\n');
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

async function countMessages(chatroomId: Id<'chatroom_rooms'>): Promise<number> {
  return await t.run(async (ctx) => {
    const rows = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
    return rows.length;
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
  const { taskId } = await seedUserOriginTask(chatroomId, 'Plan work', 'builder', 'in_progress');
  return { chatroomId, taskId };
}

describe('plans', () => {
  test('publish stores a validated plan with no room or unread side effects', async () => {
    const { sessionId } = await createTestSession('plan-publish');
    const { chatroomId } = await setupActiveBuilder(sessionId);
    const content = makePlanMarkdown(2);

    const before = await t.run(async (ctx) => {
      const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
      return { lastActivityAt: chatroom!.lastActivityAt };
    });
    const unreadBefore = await readUnreadStatus(chatroomId);

    const result = await t.mutation(api.plans.publish, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content,
    });

    expect(result.planId).toBe(result.messageId);
    expect(result.phaseIds).toEqual(['P1', 'P2']);

    const stored = await t.run((ctx) => ctx.db.get('chatroom_messages', result.messageId));
    expect(stored).not.toBeNull();
    expect(stored!.type).toBe('plan');
    expect(stored!.senderRole).toBe('builder');
    expect(stored!.content).toBe(content.trimEnd());
    expect(stored!.targetRole).toBeUndefined();
    expect(stored!.taskId).toBeUndefined();
    expect(stored!.taskOriginMessageId).toBeUndefined();
    expect(stored!.supersedesPlanId).toBeUndefined();

    const readModel = await t.run((ctx) =>
      ctx.db
        .query('chatroom_messageReadModels')
        .withIndex('by_messageId', (q) => q.eq('messageId', result.messageId))
        .first()
    );
    expect(readModel).not.toBeNull();
    expect(readModel!.type).toBe('plan');
    expect(readModel!.isTimeline).toBe(true);

    const after = await t.run(async (ctx) => {
      const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
      return { lastActivityAt: chatroom!.lastActivityAt };
    });
    expect(after.lastActivityAt).toBe(before.lastActivityAt);
    expect(await readUnreadStatus(chatroomId)).toEqual(unreadBefore);

    const latest = await t.query(api.messageList.getLatestMessages, {
      sessionId,
      chatroomId,
      limit: 20,
    });
    const latestPlan = latest.messages.find((message) => message._id === result.messageId);
    expect(latestPlan).toBeDefined();
    expect(latestPlan!.type).toBe('plan');

    const older = await t.query(api.messageList.listMessagesBefore, {
      sessionId,
      chatroomId,
      before: stored!._creationTime + 1,
      limit: 20,
    });
    expect(older.some((message) => message._id === result.messageId)).toBe(true);

    const since = await t.query(api.messages.listSinceMessage, {
      sessionId,
      chatroomId,
      sinceMessageId: result.planId,
    });
    const sincePlan = since.find((message) => message._id === result.messageId);
    expect(sincePlan).toBeDefined();
    expect(sincePlan!.type).toBe('plan');
  });

  test('rejects an invalid plan and stores nothing', async () => {
    const { sessionId } = await createTestSession('plan-invalid');
    const { chatroomId } = await setupActiveBuilder(sessionId);
    const countBefore = await countMessages(chatroomId);

    const error = await t
      .mutation(api.plans.publish, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: '# Broken plan\n\n## Sources\n- source',
      })
      .catch((thrown: { data?: { code?: string; errors?: unknown[] } }) => thrown);

    expect(error.data?.code).toBe('INVALID_PLAN');
    expect(Array.isArray(error.data?.errors)).toBe(true);
    expect(error.data!.errors!.length).toBeGreaterThan(0);
    expect(await countMessages(chatroomId)).toBe(countBefore);
  });

  test('rejects the user role and unknown roles', async () => {
    const { sessionId } = await createTestSession('plan-invalid-role');
    const { chatroomId } = await setupActiveBuilder(sessionId);
    const content = makePlanMarkdown(2);

    await expect(
      t.mutation(api.plans.publish, { sessionId, chatroomId, senderRole: 'user', content })
    ).rejects.toMatchObject({ data: { code: 'INVALID_ROLE' } });

    await expect(
      t.mutation(api.plans.publish, { sessionId, chatroomId, senderRole: 'ghost', content })
    ).rejects.toMatchObject({ data: { code: 'INVALID_ROLE' } });
  });

  test('rejects a sender with no active task without storing a row', async () => {
    const { sessionId } = await createTestSession('plan-no-task');
    const { chatroomId } = await setupActiveBuilder(sessionId);
    const countBefore = await countMessages(chatroomId);

    await expect(
      t.mutation(api.plans.publish, {
        sessionId,
        chatroomId,
        senderRole: 'planner',
        content: makePlanMarkdown(2),
      })
    ).rejects.toMatchObject({ data: { code: 'NO_ACTIVE_TASK' } });

    expect(await countMessages(chatroomId)).toBe(countBefore);
  });

  test('validates content emptiness and length', async () => {
    const { sessionId } = await createTestSession('plan-content');
    const { chatroomId } = await setupActiveBuilder(sessionId);
    const countBefore = await countMessages(chatroomId);

    await expect(
      t.mutation(api.plans.publish, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: '   ',
      })
    ).rejects.toMatchObject({ data: { code: 'EMPTY_CONTENT' } });

    await expect(
      t.mutation(api.plans.publish, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: 'x'.repeat(40_001),
      })
    ).rejects.toMatchObject({ data: { code: 'PLAN_TOO_LONG' } });

    expect(await countMessages(chatroomId)).toBe(countBefore);
  });

  test('rejects superseding a non-plan message', async () => {
    const { sessionId } = await createTestSession('plan-supersedes-non-plan');
    const { chatroomId } = await setupActiveBuilder(sessionId);
    const countBefore = await countMessages(chatroomId);
    const messageId = await t.run((ctx) =>
      ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        content: 'Not a plan',
        type: 'message',
      })
    );

    await expect(
      t.mutation(api.plans.publish, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: makePlanMarkdown(2),
        supersedesPlanId: messageId,
      })
    ).rejects.toMatchObject({ data: { code: 'INVALID_SUPERSEDES' } });

    // The seeded non-plan message is the only new row.
    expect(await countMessages(chatroomId)).toBe(countBefore + 1);
  });

  test('rejects superseding a plan from another chatroom', async () => {
    const { sessionId } = await createTestSession('plan-supersedes-other-room');
    const { chatroomId } = await setupActiveBuilder(sessionId);
    const otherChatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    const foreignPlanId = await t.run((ctx) =>
      ctx.db.insert('chatroom_messages', {
        chatroomId: otherChatroomId,
        senderRole: 'builder',
        content: makePlanMarkdown(2),
        type: 'plan',
      })
    );

    await expect(
      t.mutation(api.plans.publish, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: makePlanMarkdown(2),
        supersedesPlanId: foreignPlanId,
      })
    ).rejects.toMatchObject({ data: { code: 'INVALID_SUPERSEDES' } });
  });

  test('get returns stored content and advisory supersede links', async () => {
    const { sessionId } = await createTestSession('plan-get');
    const { chatroomId } = await setupActiveBuilder(sessionId);

    const planA = await t.mutation(api.plans.publish, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: makePlanMarkdown(2),
    });
    const planB = await t.mutation(api.plans.publish, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: makePlanMarkdown(2),
      supersedesPlanId: planA.planId,
    });

    const gotA = await t.query(api.plans.get, {
      sessionId,
      chatroomId,
      planId: planA.planId,
    });
    expect(gotA.planId).toBe(planA.planId);
    expect(gotA.content).toBe(makePlanMarkdown(2).trimEnd());
    expect(gotA.supersedes).toBeNull();
    expect(gotA.supersededBy).toBe(planB.planId);

    const gotB = await t.query(api.plans.get, {
      sessionId,
      chatroomId,
      planId: planB.planId,
    });
    expect(gotB.supersedes).toBe(planA.planId);
    expect(gotB.supersededBy).toBeNull();
  });

  test('get rejects malformed, non-plan and other-room ids', async () => {
    const { sessionId } = await createTestSession('plan-not-found');
    const { chatroomId } = await setupActiveBuilder(sessionId);
    const otherChatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    const foreignPlanId = await t.run((ctx) =>
      ctx.db.insert('chatroom_messages', {
        chatroomId: otherChatroomId,
        senderRole: 'builder',
        content: makePlanMarkdown(1),
        type: 'plan',
      })
    );
    const nonPlanId = await t.run((ctx) =>
      ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        content: 'Not a plan',
        type: 'message',
      })
    );

    for (const planId of ['not-an-id', nonPlanId, foreignPlanId]) {
      await expect(t.query(api.plans.get, { sessionId, chatroomId, planId })).rejects.toMatchObject(
        { data: { code: 'PLAN_NOT_FOUND' } }
      );
    }
  });

  test('renders a single phase from the stored plan', async () => {
    const { sessionId } = await createTestSession('plan-render');
    const { chatroomId } = await setupActiveBuilder(sessionId);

    await t.mutation(api.plans.publish, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: makePlanMarkdown(2),
    });
    const got = await t.query(api.plans.get, {
      sessionId,
      chatroomId,
      planId: (
        await t.query(api.messageList.getLatestMessages, {
          sessionId,
          chatroomId,
          limit: 20,
        })
      ).messages.find((message) => message.type === 'plan')!._id,
    });

    const parsed = parsePlan(got.content);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const rendered = renderPlanPhase(parsed.plan, 'P2');
    expect(rendered).not.toBeNull();
    expect(rendered).toContain('### P2 —');
    expect(rendered).toContain('- Phase 2 requirement.');
    expect(rendered).toContain('- Requirement one.');
    expect(renderPlanPhase(parsed.plan, 'P9')).toBeNull();
  });
});
