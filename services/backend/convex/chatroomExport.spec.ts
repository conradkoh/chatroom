/**
 * Chatroom export queries — auth and shape.
 *
 * The two Convex queries are the auth seam: `requireChatroomAccess` must run
 * before any table read, so an unauthenticated or non-owner caller fails with
 * the standard auth codes. The happy-path assertions pin the stamp and the room
 * page the driver depends on.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { errorCode } from '../src/domain/usecase/chatroom-transfer/convex-test-ports';
import { EXPORT_ALL_WORKSPACE_SCAN_CAP } from '../src/domain/usecase/chatroom-transfer/export-list';
import { t } from '../test.setup';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';

let sessionCounter = 0;

interface SessionFixture {
  sessionId: SessionId;
  userId: Id<'users'>;
}

async function createSession(): Promise<SessionFixture> {
  sessionCounter += 1;
  const sessionId = `chatroom-export-auth-${sessionCounter}` as SessionId;
  const login = await t.mutation(api.auth.loginAnon, { sessionId });
  return { sessionId, userId: login.userId as Id<'users'> };
}

async function createChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, { sessionId });
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the query to fail');
}

let workspaceCounter = 0;

/** Seeds one `chatroom_workspaces` row directly; `removedAt` makes it a soft-deleted row. */
async function seedWorkspace(
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string,
  removedAt?: number
): Promise<void> {
  workspaceCounter += 1;
  await t.run(async (ctx) => {
    await ctx.db.insert('chatroom_workspaces', {
      chatroomId,
      machineId,
      workingDir: `/work/export-all-${workspaceCounter}`,
      hostname: 'test-host',
      registeredAt: Date.now(),
      registeredBy: 'builder',
      ...(removedAt !== undefined ? { removedAt } : {}),
    });
  });
}

async function setRoom(
  chatroomId: Id<'chatroom_rooms'>,
  fields: { name?: string; lastActivityAt?: number; status?: 'active' | 'completed' }
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.patch('chatroom_rooms', chatroomId, fields);
  });
}

describe('chatroomExport auth', () => {
  test('rejects an unknown session on both queries with AUTH_FAILED', async () => {
    const { sessionId } = await createSession();
    const chatroomId = await createChatroom(sessionId);
    const unknownSession = 'chatroom-export-never-logged-in' as SessionId;

    const stampError = await failure(
      t.query(api.chatroomExport.getStamp, { sessionId: unknownSession, chatroomId })
    );
    expect(errorCode(stampError)).toBe('AUTH_FAILED');

    const pageError = await failure(
      t.query(api.chatroomExport.readPage, {
        sessionId: unknownSession,
        chatroomId,
        category: 'room',
        cursor: null,
      })
    );
    expect(errorCode(pageError)).toBe('AUTH_FAILED');
  });

  test("rejects a second user's session on another owner's chatroom with ACCESS_DENIED", async () => {
    const owner = await createSession();
    const stranger = await createSession();
    const chatroomId = await createChatroom(owner.sessionId);

    const stampError = await failure(
      t.query(api.chatroomExport.getStamp, { sessionId: stranger.sessionId, chatroomId })
    );
    expect(errorCode(stampError)).toBe('ACCESS_DENIED');

    const pageError = await failure(
      t.query(api.chatroomExport.readPage, {
        sessionId: stranger.sessionId,
        chatroomId,
        category: 'messages',
        cursor: null,
      })
    );
    expect(errorCode(pageError)).toBe('ACCESS_DENIED');
  });
});

describe('chatroomExport reads', () => {
  test('returns an empty stamp for a fresh chatroom', async () => {
    const { sessionId } = await createSession();
    const chatroomId = await createChatroom(sessionId);

    const stamp = await t.query(api.chatroomExport.getStamp, { sessionId, chatroomId });

    expect(stamp.attachmentRows).toEqual({ count: 0, capped: false });
    expect(stamp.latestMessage).toBeNull();
    expect(stamp.lastActivityAt).toBeNull();
    expect(stamp.nextQueuePosition).toBeNull();
  });

  test('returns the room category as one finished row', async () => {
    const { sessionId } = await createSession();
    const chatroomId = await createChatroom(sessionId);

    const page = await t.query(api.chatroomExport.readPage, {
      sessionId,
      chatroomId,
      category: 'room',
      cursor: null,
    });

    expect(page.isDone).toBe(true);
    expect(page.continueCursor).toBeNull();
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].id).toBe(chatroomId);
    expect(page.rows[0].fields.status).toBe('active');
    // `insertChatroomWithTeam` writes the active team structure, so the room row
    // carries it.
    expect(typeof page.rows[0].fields.teamStructureId).toBe('string');
  });
});

describe('chatroomExport.listForMachine', () => {
  const MACHINE = 'machine-export-all';

  test('rejects an unknown session with AUTH_FAILED', async () => {
    const error = await failure(
      t.query(api.chatroomExport.listForMachine, {
        sessionId: 'chatroom-export-never-logged-in' as SessionId,
        machineId: MACHINE,
      })
    );
    expect(errorCode(error)).toBe('AUTH_FAILED');
  });

  test('lists the caller room that has an active workspace on the machine, with name and status', async () => {
    const { sessionId } = await createSession();
    const chatroomId = await createChatroom(sessionId);
    await setRoom(chatroomId, { name: 'Alpha' });
    await seedWorkspace(chatroomId, MACHINE);

    const rooms = await t.query(api.chatroomExport.listForMachine, {
      sessionId,
      machineId: MACHINE,
    });

    expect(rooms).toEqual([{ chatroomId, name: 'Alpha', status: 'active' }]);
  });

  test('returns name null for a room with no name', async () => {
    const { sessionId } = await createSession();
    const chatroomId = await createChatroom(sessionId);
    await seedWorkspace(chatroomId, MACHINE);

    const rooms = await t.query(api.chatroomExport.listForMachine, {
      sessionId,
      machineId: MACHINE,
    });

    expect(rooms).toEqual([{ chatroomId, name: null, status: 'active' }]);
  });

  test('excludes a room whose only workspace on the machine was removed', async () => {
    const { sessionId } = await createSession();
    const chatroomId = await createChatroom(sessionId);
    await seedWorkspace(chatroomId, MACHINE, Date.now());

    const rooms = await t.query(api.chatroomExport.listForMachine, {
      sessionId,
      machineId: MACHINE,
    });

    expect(rooms).toEqual([]);
  });

  test('lists a room with two active workspaces on the machine once', async () => {
    const { sessionId } = await createSession();
    const chatroomId = await createChatroom(sessionId);
    await seedWorkspace(chatroomId, MACHINE);
    await seedWorkspace(chatroomId, MACHINE);

    const rooms = await t.query(api.chatroomExport.listForMachine, {
      sessionId,
      machineId: MACHINE,
    });

    expect(rooms.map((room) => room.chatroomId)).toEqual([chatroomId]);
  });

  test('excludes a room with no workspace on the machine', async () => {
    const { sessionId } = await createSession();
    await createChatroom(sessionId);

    const rooms = await t.query(api.chatroomExport.listForMachine, {
      sessionId,
      machineId: MACHINE,
    });

    expect(rooms).toEqual([]);
  });

  test("excludes another user's room even when it has an active workspace on the machine", async () => {
    const caller = await createSession();
    const stranger = await createSession();
    const ownRoom = await createChatroom(caller.sessionId);
    const strangerRoom = await createChatroom(stranger.sessionId);
    await seedWorkspace(ownRoom, MACHINE);
    await seedWorkspace(strangerRoom, MACHINE);

    const rooms = await t.query(api.chatroomExport.listForMachine, {
      sessionId: caller.sessionId,
      machineId: MACHINE,
    });

    expect(rooms.map((room) => room.chatroomId)).toEqual([ownRoom]);
  });

  test('excludes a room whose workspace is on a different machine', async () => {
    const { sessionId } = await createSession();
    const chatroomId = await createChatroom(sessionId);
    await seedWorkspace(chatroomId, 'machine-other');

    const rooms = await t.query(api.chatroomExport.listForMachine, {
      sessionId,
      machineId: MACHINE,
    });

    expect(rooms).toEqual([]);
  });

  test('includes a completed room with its completed status', async () => {
    const { sessionId } = await createSession();
    const chatroomId = await createChatroom(sessionId);
    await setRoom(chatroomId, { status: 'completed' });
    await seedWorkspace(chatroomId, MACHINE);

    const rooms = await t.query(api.chatroomExport.listForMachine, {
      sessionId,
      machineId: MACHINE,
    });

    expect(rooms).toEqual([{ chatroomId, name: null, status: 'completed' }]);
  });

  test('orders rooms by most recent activity first', async () => {
    const { sessionId } = await createSession();
    const older = await createChatroom(sessionId);
    const newest = await createChatroom(sessionId);
    const middle = await createChatroom(sessionId);
    await setRoom(older, { lastActivityAt: 100 });
    await setRoom(newest, { lastActivityAt: 300 });
    await setRoom(middle, { lastActivityAt: 200 });
    for (const id of [older, newest, middle]) await seedWorkspace(id, MACHINE);

    const rooms = await t.query(api.chatroomExport.listForMachine, {
      sessionId,
      machineId: MACHINE,
    });

    expect(rooms.map((room) => room.chatroomId)).toEqual([newest, middle, older]);
  });

  test('fails with EXPORT_MACHINE_TOO_LARGE above the scan cap', async () => {
    // Its own machine: convex-test keeps one database for the whole file, so rows
    // seeded here would leak into the at-cap test on the shared machine.
    const OVER_CAP_MACHINE = 'machine-export-all-over-cap';
    const { sessionId } = await createSession();
    const chatroomId = await createChatroom(sessionId);
    await t.run(async (ctx) => {
      for (let i = 0; i < EXPORT_ALL_WORKSPACE_SCAN_CAP + 1; i++) {
        await ctx.db.insert('chatroom_workspaces', {
          chatroomId,
          machineId: OVER_CAP_MACHINE,
          workingDir: `/work/over-cap-${i}`,
          hostname: 'test-host',
          registeredAt: Date.now(),
          registeredBy: 'builder',
        });
      }
    });

    const error = await failure(
      t.query(api.chatroomExport.listForMachine, { sessionId, machineId: OVER_CAP_MACHINE })
    );
    expect(errorCode(error)).toBe('EXPORT_MACHINE_TOO_LARGE');
  });

  test('succeeds with exactly the scan cap of active workspace rows', async () => {
    const AT_CAP_MACHINE = 'machine-export-all-at-cap';
    const { sessionId } = await createSession();
    const chatroomId = await createChatroom(sessionId);
    await t.run(async (ctx) => {
      for (let i = 0; i < EXPORT_ALL_WORKSPACE_SCAN_CAP; i++) {
        await ctx.db.insert('chatroom_workspaces', {
          chatroomId,
          machineId: AT_CAP_MACHINE,
          workingDir: `/work/at-cap-${i}`,
          hostname: 'test-host',
          registeredAt: Date.now(),
          registeredBy: 'builder',
        });
      }
    });

    const rooms = await t.query(api.chatroomExport.listForMachine, {
      sessionId,
      machineId: AT_CAP_MACHINE,
    });

    expect(rooms.map((room) => room.chatroomId)).toEqual([chatroomId]);
  });

  test('returns an empty list for an unknown machine', async () => {
    const { sessionId } = await createSession();

    const rooms = await t.query(api.chatroomExport.listForMachine, {
      sessionId,
      machineId: 'machine-never-registered',
    });

    expect(rooms).toEqual([]);
  });
});
