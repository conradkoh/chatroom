/**
 * Chatroom membership authorization.
 *
 * Verifies a user has access to a machine through chatroom membership.
 * Uses dependency inversion — the core logic is a pure function that
 * receives data-access callbacks, making it testable without a real DB.
 *
 * Trust model: A machine that joins a chatroom is willing to accept
 * interactions from users who belong to that chatroom.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** Minimal chatroom representation for authorization checks. */
export interface ChatroomRef {
  _id: string;
  ownerId: string;
}

/** Minimal workspace registration linking a machine to a chatroom. */
export interface WorkspaceRef {
  chatroomId: string;
  machineId: string;
}

/** Result of a chatroom membership check. */
export type MembershipCheckResult =
  | { authorized: true; chatroomId: string }
  | { authorized: false; reason: string };

/**
 * Data access interface for chatroom membership checks.
 * Injected at call site — enables pure-function testing.
 */
export interface ChatroomMembershipDeps {
  /** Find all workspace registrations for a given machineId. */
  getWorkspacesForMachine: (machineId: string) => Promise<WorkspaceRef[]>;
  /** Look up a chatroom by ID. */
  getChatroom: (chatroomId: string) => Promise<ChatroomRef | null>;
}

// ─── Core Logic (pure) ──────────────────────────────────────────────────────

/**
 * Check if a user has chatroom access to a machine.
 *
 * A user has access if they own (or are a member of) at least one chatroom
 * that the machine is registered in via workspace registration.
 *
 * @param deps - Injected data access functions
 * @param machineId - The machine to check access for
 * @param userId - The user requesting access
 * @returns Authorization result with the matching chatroomId or rejection reason
 */
export async function checkChatroomMembershipForMachine(
  deps: ChatroomMembershipDeps,
  machineId: string,
  userId: string
): Promise<MembershipCheckResult> {
  // 1. Find chatrooms this machine belongs to via workspace registrations
  const workspaces = await deps.getWorkspacesForMachine(machineId);

  if (workspaces.length === 0) {
    return { authorized: false, reason: 'Machine has no workspace registrations' };
  }

  // 2. Deduplicate chatroom IDs
  const chatroomIds = [...new Set(workspaces.map((w) => w.chatroomId))];

  // 3. Check if user has access to any of these chatrooms
  for (const chatroomId of chatroomIds) {
    const chatroom = await deps.getChatroom(chatroomId);
    if (!chatroom) continue;

    // Currently: owner check. Future: extend with membership/invite checks.
    if (chatroom.ownerId === userId) {
      return { authorized: true, chatroomId };
    }
  }

  return { authorized: false, reason: 'User does not have access to any chatroom with this machine' };
}
