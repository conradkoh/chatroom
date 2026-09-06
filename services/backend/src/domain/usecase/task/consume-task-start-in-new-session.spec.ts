/**
 * Tests for consumeTaskStartInNewSession — exactly-once consumption of the
 * one-shot "start in a new session" request via the immutable task envelope.
 */

import type { TaskEnvelopeV1 } from '@workspace/shared/domain/task-envelope';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { consumeTaskStartInNewSession } from './consume-task-start-in-new-session';
import { api } from '../../../../convex/_generated/api';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';

type TaskRow = Doc<'chatroom_tasks'>;

async function createTestSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId };
}

async function createChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
}

interface SeedTaskFields {
  startInNewSession?: boolean | undefined;
  taskEnvelope?: TaskEnvelopeV1 | undefined;
  sessionPolicyConsumedAt?: number | undefined;
}

/** Inserts the minimum valid chatroom_tasks row with any requested policy fields. */
async function seedTask(
  chatroomId: Id<'chatroom_rooms'>,
  fields: SeedTaskFields = {}
): Promise<Id<'chatroom_tasks'>> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: 'consume-start-in-new-session task',
      status: 'pending',
      queuePosition: 0,
      createdAt: now,
      updatedAt: now,
      ...(fields.startInNewSession !== undefined
        ? { startInNewSession: fields.startInNewSession }
        : {}),
      ...(fields.taskEnvelope !== undefined ? { taskEnvelope: fields.taskEnvelope } : {}),
      ...(fields.sessionPolicyConsumedAt !== undefined
        ? { sessionPolicyConsumedAt: fields.sessionPolicyConsumedAt }
        : {}),
    });
  });
}

async function readTask(taskId: Id<'chatroom_tasks'>): Promise<TaskRow | null> {
  return await t.run(async (ctx) => {
    return await ctx.db.get('chatroom_tasks', taskId);
  });
}

async function consume(taskId: Id<'chatroom_tasks'>): Promise<boolean> {
  return await t.run(async (ctx) => {
    return await consumeTaskStartInNewSession(ctx, taskId);
  });
}

const NEW_ENVELOPE: TaskEnvelopeV1 = {
  version: 1,
  conversationMode: 'code',
  sessionPolicy: 'new',
  handoffWorkflow: { preset: 'team', phase: 'entry' },
};

const CONTINUE_ENVELOPE: TaskEnvelopeV1 = {
  version: 1,
  conversationMode: 'chat',
  sessionPolicy: 'continue',
  handoffWorkflow: { preset: 'direct', phase: 'entry' },
};

describe('consumeTaskStartInNewSession', () => {
  test('consumes an explicit new-session envelope with no legacy scalar exactly once', async () => {
    const { sessionId } = await createTestSession('consume-new-1');
    const chatroomId = await createChatroom(sessionId);
    const taskId = await seedTask(chatroomId, { taskEnvelope: NEW_ENVELOPE });

    expect(await consume(taskId)).toBe(true);

    const afterFirst = await readTask(taskId);
    expect(afterFirst?.sessionPolicyConsumedAt).toBeTypeOf('number');
    expect(afterFirst?.startInNewSession).toBeUndefined();
    expect(afterFirst?.taskEnvelope).toEqual(NEW_ENVELOPE);

    const firstReceipt = afterFirst?.sessionPolicyConsumedAt;
    expect(await consume(taskId)).toBe(false);

    const afterSecond = await readTask(taskId);
    expect(afterSecond?.sessionPolicyConsumedAt).toBe(firstReceipt);
    expect(afterSecond?.taskEnvelope).toEqual(NEW_ENVELOPE);
  });

  test('explicit continue envelope wins over a stale legacy scalar', async () => {
    const { sessionId } = await createTestSession('consume-continue-1');
    const chatroomId = await createChatroom(sessionId);
    const taskId = await seedTask(chatroomId, {
      taskEnvelope: CONTINUE_ENVELOPE,
      startInNewSession: true,
    });

    expect(await consume(taskId)).toBe(false);

    const after = await readTask(taskId);
    expect(after?.sessionPolicyConsumedAt).toBeUndefined();
    expect(after?.taskEnvelope).toEqual(CONTINUE_ENVELOPE);
    expect(after?.startInNewSession).toBe(true);
  });

  test('legacy task without an envelope is normalized from the scalar and consumed', async () => {
    const { sessionId } = await createTestSession('consume-legacy-1');
    const chatroomId = await createChatroom(sessionId);
    const taskId = await seedTask(chatroomId, { startInNewSession: true });

    expect(await consume(taskId)).toBe(true);

    const after = await readTask(taskId);
    expect(after?.sessionPolicyConsumedAt).toBeTypeOf('number');
    expect(after?.startInNewSession).toBeUndefined();
    expect(after?.taskEnvelope).toBeUndefined();
  });

  test('legacy default continue task returns false and writes no receipt', async () => {
    const { sessionId } = await createTestSession('consume-legacy-continue-1');
    const chatroomId = await createChatroom(sessionId);
    const taskId = await seedTask(chatroomId, {});

    expect(await consume(taskId)).toBe(false);

    const after = await readTask(taskId);
    expect(after?.sessionPolicyConsumedAt).toBeUndefined();
    expect(after?.taskEnvelope).toBeUndefined();
  });

  test('returns false for a missing task', async () => {
    const { sessionId } = await createTestSession('consume-missing-1');
    const chatroomId = await createChatroom(sessionId);
    const taskId = await seedTask(chatroomId, {});
    await t.run(async (ctx) => {
      await ctx.db.delete('chatroom_tasks', taskId);
    });

    expect(await consume(taskId)).toBe(false);
  });
});
