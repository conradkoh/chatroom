/**
 * Shared Convex args for queries scoped to one chatroom and the caller's session. Defined once so
 * the chatroom and workspace queries cannot drift apart.
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

export const chatroomSessionArgs = {
  ...SessionIdArg,
  chatroomId: v.id('chatroom_rooms'),
};
