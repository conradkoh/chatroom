/**
 * Use Case: List Exportable Chatrooms For A Machine
 *
 * The predicate behind `chatroom export`. A chatroom is listed when the user owns it and it has an
 * active workspace on the machine. Machine scoping is enforced here, at the single chokepoint that
 * both the CLI and the webapp machine card call. Ownership is the authorization: it is the same owner
 * check `requireChatroomAccess` applies. Machine permission is deliberately not checked. A machine's
 * workspace rows can belong to other users' chatrooms, and the owner filter removes them.
 */

import { ConvexError } from 'convex/values';

import { BACKEND_ERROR_CODES } from '../../../../config/errorCodes';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import { sortByLastActivity } from '../chatroom/list-owned-chatrooms';

/**
 * Most active workspace rows read per machine. The rows count every user's chatrooms on the
 * machine, so the cap can be reached by other users' workspaces.
 */
export const EXPORT_ALL_WORKSPACE_SCAN_CAP = 1000;

export interface ExportableChatroom {
  chatroomId: Id<'chatroom_rooms'>;
  name: string | null;
  status: 'active' | 'completed';
}

/**
 * Chatrooms owned by `userId` with an active workspace on `machineId`, most recent activity first.
 * Reads at most `EXPORT_ALL_WORKSPACE_SCAN_CAP + 1` workspace rows and one room per distinct
 * chatroom. Throws `EXPORT_MACHINE_TOO_LARGE` rather than truncating.
 */
export async function listExportableChatroomsForMachine(
  ctx: Pick<QueryCtx, 'db'>,
  input: { userId: Id<'users'>; machineId: string }
): Promise<ExportableChatroom[]> {
  const rows = await ctx.db
    .query('chatroom_workspaces')
    .withIndex('by_machine_removedAt', (q) =>
      q.eq('machineId', input.machineId).eq('removedAt', undefined)
    )
    .take(EXPORT_ALL_WORKSPACE_SCAN_CAP + 1);

  if (rows.length > EXPORT_ALL_WORKSPACE_SCAN_CAP) {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.EXPORT_MACHINE_TOO_LARGE,
      message: `This machine has more than ${EXPORT_ALL_WORKSPACE_SCAN_CAP} active workspaces, counting other users' chatrooms, so its chatrooms cannot be exported together.`,
    });
  }

  const chatroomIds = [...new Set(rows.map((row) => row.chatroomId))];
  const rooms = await Promise.all(chatroomIds.map((id) => ctx.db.get('chatroom_rooms', id)));
  const owned = rooms.filter(
    (room): room is Doc<'chatroom_rooms'> => room !== null && room.ownerId === input.userId
  );

  return sortByLastActivity(owned).map((room) => ({
    chatroomId: room._id,
    name: room.name ?? null,
    status: room.status,
  }));
}
