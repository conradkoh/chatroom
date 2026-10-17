/**
 * Migration: backfillActiveTaskHeaders
 *
 * Seeds chatroom_activeTaskHeaders from current task truth. Idempotent: it also
 * removes rows for tasks that are no longer active or assigned.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';

async function createChatroom(id: string): Promise<Id<'chatroom_rooms'>> {
  const sessionId = id as SessionId;
  const login = await t.mutation(api.auth.loginAnon, { sessionId });
  expect(login.success).toBe(true);
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'builder',
  });
}

/** Force a fresh pass so each test exercises migrateOne for the rows it seeds. */
async function runMigration() {
  return await t.mutation(internal.migrations.backfillActiveTaskHeaders, {
    cursor: null,
    batchSize: 25,
    reset: true,
  });
}

function seedTask(
  chatroomId: Id<'chatroom_rooms'>,
  fields: { status: Doc<'chatroom_tasks'>['status']; assignedTo?: string; createdAt: number }
) {
  return t.run(async (ctx) =>
    ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: 'body',
      status: fields.status,
      ...(fields.assignedTo === undefined ? {} : { assignedTo: fields.assignedTo }),
      createdAt: fields.createdAt,
      updatedAt: fields.createdAt,
      queuePosition: 0,
    })
  );
}

function readHeaders(chatroomId: Id<'chatroom_rooms'>) {
  return t.run(async (ctx) =>
    ctx.db
      .query('chatroom_activeTaskHeaders')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect()
  );
}

describe('migration: backfillActiveTaskHeaders', () => {
  test('creates rows only for active, assigned tasks', async () => {
    const chatroomId = await createChatroom('mig-active-headers');
    const pending = await seedTask(chatroomId, {
      status: 'pending',
      assignedTo: 'builder',
      createdAt: 1,
    });
    const acknowledged = await seedTask(chatroomId, {
      status: 'acknowledged',
      assignedTo: 'builder',
      createdAt: 2,
    });
    const inProgress = await seedTask(chatroomId, {
      status: 'in_progress',
      assignedTo: 'builder',
      createdAt: 3,
    });
    await seedTask(chatroomId, { status: 'pending', createdAt: 4 }); // active but unassigned
    await seedTask(chatroomId, { status: 'completed', assignedTo: 'builder', createdAt: 5 });
    await seedTask(chatroomId, { status: 'closed', assignedTo: 'builder', createdAt: 6 });

    await runMigration();

    const rows = await readHeaders(chatroomId);
    expect(rows.map((row) => row.taskId).sort()).toEqual(
      [pending, acknowledged, inProgress].sort()
    );
    expect(rows.every((row) => row.assignedTo === 'builder')).toBe(true);
  });

  test('is idempotent: a second run leaves the same rows', async () => {
    const chatroomId = await createChatroom('mig-active-headers-idem');
    const active = await seedTask(chatroomId, {
      status: 'in_progress',
      assignedTo: 'builder',
      createdAt: 10,
    });
    await seedTask(chatroomId, { status: 'completed', assignedTo: 'builder', createdAt: 11 });

    await runMigration();
    const first = await readHeaders(chatroomId);
    await runMigration();
    const second = await readHeaders(chatroomId);

    expect(second.map((row) => row.taskId)).toEqual([active]);
    expect(second.map((row) => row._id).sort()).toEqual(first.map((row) => row._id).sort());
  });

  test('removes a stale row for a completed task', async () => {
    const chatroomId = await createChatroom('mig-active-headers-stale');
    const completed = await seedTask(chatroomId, {
      status: 'completed',
      assignedTo: 'builder',
      createdAt: 20,
    });

    // Simulate a stale projection row left over from when the task was active.
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_activeTaskHeaders', {
        taskId: completed,
        chatroomId,
        status: 'pending',
        assignedTo: 'builder',
        createdAt: 20,
        updatedAt: 20,
      });
    });
    expect(await readHeaders(chatroomId)).toHaveLength(1);

    await runMigration();

    expect(await readHeaders(chatroomId)).toHaveLength(0);
  });
});
