/**
 * Shared session check for `chatroom export` and `chatroom import`.
 *
 * Both commands refuse to run without a session, print the same auth error and
 * exit 1. One implementation keeps the two paths from drifting apart.
 */

import type { SessionId } from 'convex-helpers/server/sessions';

import type { ChatroomTransferDeps } from './deps.js';
import { formatAuthError } from '../../utils/error-formatting.js';

/** Returns the session, or reports the auth error through the shared formatter, exits 1 and returns null. */
export async function requireTransferSession(
  deps: ChatroomTransferDeps
): Promise<SessionId | null> {
  const sessionId = await deps.session.getSessionId();
  if (sessionId !== null) return sessionId;
  formatAuthError(deps.session.getConvexUrl(), await deps.session.getOtherSessionUrls());
  deps.exit(1);
  return null;
}
