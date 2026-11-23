/**
 * Plan row predicate shared by the publish use case and the plan read query.
 * Pure: a plan is a `type: 'plan'` message in the given chatroom.
 */

import type { Doc, Id } from '../../../convex/_generated/dataModel';

/** True when the row is a `type: 'plan'` message in the given chatroom. */
export function isPlanInChatroom(
  row: Doc<'chatroom_messages'> | null,
  chatroomId: Id<'chatroom_rooms'>
): row is Doc<'chatroom_messages'> {
  return row !== null && row.chatroomId === chatroomId && row.type === 'plan';
}
