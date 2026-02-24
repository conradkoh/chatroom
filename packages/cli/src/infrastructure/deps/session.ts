/**
 * Session Operations — shared dependency interface for authentication.
 *
 * Wraps session ID retrieval and URL lookup so command handlers
 * can be tested without touching the real credential store.
 */

import type { SessionId } from 'convex-helpers/server/sessions';

export interface SessionOps {
  /** Get the current session ID, or null if not authenticated */
  getSessionId: () => SessionId | null;
  /** Get the Convex deployment URL */
  getConvexUrl: () => string;
  /** Get URLs of other authenticated sessions (for error guidance) */
  getOtherSessionUrls: () => string[];
}
