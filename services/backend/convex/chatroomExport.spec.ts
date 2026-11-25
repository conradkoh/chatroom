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
