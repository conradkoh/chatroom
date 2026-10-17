/**
 * Unit tests for the chatroom_activeTaskHeaders projection writer.
 *
 * Uses a fake MutationCtx so we can assert exactly which db operations run — in
 * particular that an unchanged task causes no write (no-op suppression).
 */

import { describe, expect, test } from 'vitest';

import { removeActiveTaskHeader, syncActiveTaskHeader } from './active-task-header';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

type Op =
  | { kind: 'insert'; table: string; value: Record<string, unknown> }
  | { kind: 'patch'; table: string; id: string; value: Record<string, unknown> }
  | { kind: 'delete'; table: string; id: string };

function makeFakeCtx(existing: Doc<'chatroom_activeTaskHeaders'> | null) {
  const ops: Op[] = [];
  const ctx = {
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => existing,
        }),
      }),
      insert: async (table: string, value: Record<string, unknown>) => {
        ops.push({ kind: 'insert', table, value });
        return 'inserted_id';
      },
      patch: async (table: string, id: string, value: Record<string, unknown>) => {
        ops.push({ kind: 'patch', table, id, value });
      },
      delete: async (table: string, id: string) => {
        ops.push({ kind: 'delete', table, id });
      },
    },
  } as unknown as MutationCtx;
  return { ctx, ops };
}

function taskDoc(overrides: Partial<Doc<'chatroom_tasks'>> = {}): Doc<'chatroom_tasks'> {
  return {
    _id: 'task_1' as Id<'chatroom_tasks'>,
    _creationTime: 1,
    chatroomId: 'room_1' as Id<'chatroom_rooms'>,
    createdBy: 'user',
    content: 'body',
    status: 'pending',
    assignedTo: 'builder',
    createdAt: 100,
    updatedAt: 200,
    queuePosition: 0,
    ...overrides,
  };
}

function headerDoc(
  overrides: Partial<Doc<'chatroom_activeTaskHeaders'>> = {}
): Doc<'chatroom_activeTaskHeaders'> {
  return {
    _id: 'header_1' as Id<'chatroom_activeTaskHeaders'>,
    _creationTime: 1,
    taskId: 'task_1' as Id<'chatroom_tasks'>,
    chatroomId: 'room_1' as Id<'chatroom_rooms'>,
    status: 'pending',
    assignedTo: 'builder',
    createdAt: 100,
    updatedAt: 200,
    ...overrides,
  };
}

describe('syncActiveTaskHeader', () => {
  test('inserts a slim row for an active, assigned task', async () => {
    const { ctx, ops } = makeFakeCtx(null);

    await syncActiveTaskHeader(ctx, taskDoc({ startInNewSession: true }));

    expect(ops).toEqual([
      {
        kind: 'insert',
        table: 'chatroom_activeTaskHeaders',
        value: {
          taskId: 'task_1',
          chatroomId: 'room_1',
          status: 'pending',
          assignedTo: 'builder',
          createdAt: 100,
          updatedAt: 200,
          startInNewSession: true,
        },
      },
    ]);
  });

  test('omits startInNewSession when the task has none', async () => {
    const { ctx, ops } = makeFakeCtx(null);

    await syncActiveTaskHeader(ctx, taskDoc());

    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'insert' });
    expect((ops[0] as { value: Record<string, unknown> }).value).not.toHaveProperty(
      'startInNewSession'
    );
  });

  test('is a no-op when the existing row already matches (no patch)', async () => {
    const { ctx, ops } = makeFakeCtx(headerDoc());

    await syncActiveTaskHeader(ctx, taskDoc());

    expect(ops).toEqual([]);
  });

  test('patches when a header field differs', async () => {
    const { ctx, ops } = makeFakeCtx(headerDoc({ status: 'acknowledged' }));

    await syncActiveTaskHeader(ctx, taskDoc({ status: 'in_progress' }));

    expect(ops).toEqual([
      {
        kind: 'patch',
        table: 'chatroom_activeTaskHeaders',
        id: 'header_1',
        value: {
          taskId: 'task_1',
          chatroomId: 'room_1',
          status: 'in_progress',
          assignedTo: 'builder',
          createdAt: 100,
          updatedAt: 200,
        },
      },
    ]);
  });

  test('deletes the row when the task becomes inactive', async () => {
    const { ctx, ops } = makeFakeCtx(headerDoc());

    await syncActiveTaskHeader(ctx, taskDoc({ status: 'completed' }));

    expect(ops).toEqual([{ kind: 'delete', table: 'chatroom_activeTaskHeaders', id: 'header_1' }]);
  });

  test('deletes the row when the task becomes unassigned', async () => {
    const { ctx, ops } = makeFakeCtx(headerDoc());

    await syncActiveTaskHeader(ctx, taskDoc({ assignedTo: undefined }));

    expect(ops).toEqual([{ kind: 'delete', table: 'chatroom_activeTaskHeaders', id: 'header_1' }]);
  });

  test('does nothing when inactive and no row exists', async () => {
    const { ctx, ops } = makeFakeCtx(null);

    await syncActiveTaskHeader(ctx, taskDoc({ status: 'completed', assignedTo: undefined }));

    expect(ops).toEqual([]);
  });
});

describe('removeActiveTaskHeader', () => {
  test('deletes the row when present', async () => {
    const { ctx, ops } = makeFakeCtx(headerDoc());

    await removeActiveTaskHeader(ctx, 'task_1' as Id<'chatroom_tasks'>);

    expect(ops).toEqual([{ kind: 'delete', table: 'chatroom_activeTaskHeaders', id: 'header_1' }]);
  });

  test('is a no-op when no row exists', async () => {
    const { ctx, ops } = makeFakeCtx(null);

    await removeActiveTaskHeader(ctx, 'task_1' as Id<'chatroom_tasks'>);

    expect(ops).toEqual([]);
  });
});
