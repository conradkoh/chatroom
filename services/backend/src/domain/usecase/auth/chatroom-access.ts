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
export interface ChatroomAccessDeps {
  getChatroom: (chatroomId: string) => Promise<ChatroomRecord | null>;
}

/** Successful chatroom access result. */
export interface ChatroomAccessGranted {
  hasAccess: true;
  chatroomId: string;
  ownerId: string;
}

/** Failed chatroom access result. */
export interface ChatroomAccessDenied {
  hasAccess: false;
  reason: string;
}

/** Result of checking chatroom access. */
export type ChatroomAccessResult = ChatroomAccessGranted | ChatroomAccessDenied;

// ─── Core Logic ─────────────────────────────────────────────────────────────

/**
 * Check if a user has access to a chatroom.
 *
 * Currently checks ownership only. Future: extend with membership/invite checks.
 */
export async function checkChatroomAccess(
  deps: ChatroomAccessDeps,
  chatroomId: string,
  userId: string
): Promise<ChatroomAccessResult> {
  const chatroom = await deps.getChatroom(chatroomId);

  if (!chatroom) {
    return { hasAccess: false, reason: 'Chatroom not found' };
  }

  if (chatroom.ownerId === userId) {
    return { hasAccess: true, chatroomId, ownerId: chatroom.ownerId };
  }

  return { hasAccess: false, reason: 'Access denied: You do not own this chatroom' };
}
