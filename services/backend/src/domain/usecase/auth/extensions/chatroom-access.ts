/**
 * Chatroom Access — pure functions for checking chatroom access.
 *
 * Extracted from convex/auth/cliSessionAuth.ts.
 * Uses dependency injection for database access.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** Minimal chatroom shape needed for access checks. */
export interface ChatroomRecord {
  id: string;
  ownerId: string;
}

/** Database access for chatroom access checks. */
export interface CheckChatroomAccessDeps {
  getChatroom: (chatroomId: string) => Promise<ChatroomRecord | null>;
}

/** Successful chatroom access result. */
export interface ChatroomAccessSuccess {
  ok: true;
  chatroomId: string;
  ownerId: string;
}

/** Failed chatroom access result. */
export interface ChatroomAccessFailure {
  ok: false;
  reason: string;
}

/** Result of checking chatroom access. */
export type ChatroomAccessResult = ChatroomAccessSuccess | ChatroomAccessFailure;

// ─── Core Logic ─────────────────────────────────────────────────────────────

/**
 * Check if a user has access to a chatroom.
 *
 * Currently checks ownership only. Future: extend with membership/invite checks.
 */
export async function checkChatroomAccess(
  deps: CheckChatroomAccessDeps,
  chatroomId: string,
  userId: string
): Promise<ChatroomAccessResult> {
  const chatroom = await deps.getChatroom(chatroomId);

  if (!chatroom) {
    return { ok: false, reason: 'Chatroom not found' };
  }

  if (chatroom.ownerId === userId) {
    return { ok: true, chatroomId, ownerId: chatroom.ownerId };
  }

  return { ok: false, reason: 'Access denied: You do not own this chatroom' };
}
