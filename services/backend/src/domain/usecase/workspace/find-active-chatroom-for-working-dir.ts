/**
 * Use Case: Find the active chatroom for a machine working directory.
 *
 * "Has chatroom" = an active (status 'active'), owner-matching chatroom has a workspace row
 * for (machineId, normalized workingDir) whose removedAt is undefined. Archived chatrooms
 * (status 'completed') and removed workspaces never match. Legacy rows stored with an
 * un-normalized path (e.g. a trailing slash) do not match: the input is normalized, the stored
 * key is compared exactly.
 *
 * Callers: repositoryLedger.listEntries, bulk create.
 */
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import { normalizeWorkingDir } from '../../../../convex/workspacePathSecurity';

export interface FindActiveChatroomForWorkingDirInput {
  ownerId: Id<'users'>;
  machineId: string;
  /** Any spelling accepted by normalizeWorkingDir. Throws for invalid paths; callers validate first. */
  workingDir: string;
}

export interface ActiveChatroomMatch {
  chatroomId: Id<'chatroom_rooms'>;
}

/** True when the chatroom exists, is active and is owned by the requester. */
function isActiveChatroomOwnedBy(
  chatroom: Doc<'chatroom_rooms'> | null,
  ownerId: Id<'users'>
): chatroom is Doc<'chatroom_rooms'> {
  return chatroom !== null && chatroom.status === 'active' && chatroom.ownerId === ownerId;
}

export async function findActiveChatroomForWorkingDir(
  ctx: Pick<QueryCtx, 'db'>,
  input: FindActiveChatroomForWorkingDirInput
): Promise<ActiveChatroomMatch | null> {
  const workingDir = normalizeWorkingDir(input.workingDir);
  // Bounded by the number of chatrooms that have ever used this exact directory on this machine.
  const workspaces = await ctx.db
    .query('chatroom_workspaces')
    .withIndex('by_machine_workingDir', (q) =>
      q.eq('machineId', input.machineId).eq('workingDir', workingDir)
    )
    .collect();

  for (const workspace of workspaces) {
    if (workspace.removedAt !== undefined) continue;
    const chatroom = await ctx.db.get('chatroom_rooms', workspace.chatroomId);
    if (isActiveChatroomOwnedBy(chatroom, input.ownerId)) {
      return { chatroomId: chatroom._id };
    }
  }
  return null;
}
