/**
 * Grounding row predicate shared by the publish use case and the read query.
 * Pure: a grounding is a `type: 'grounding'` message in the given chatroom.
 */

import type { Doc, Id } from '../../../convex/_generated/dataModel';

/** True when the row is a `type: 'grounding'` message in the given chatroom. */
export function isGroundingInChatroom(
  row: Doc<'chatroom_messages'> | null,
  chatroomId: Id<'chatroom_rooms'>
): row is Doc<'chatroom_messages'> {
  return row !== null && row.chatroomId === chatroomId && row.type === 'grounding';
}
