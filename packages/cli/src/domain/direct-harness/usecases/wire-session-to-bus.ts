/**
 * Domain service: wire a DirectHarnessSession to publish events onto a
 * HarnessReplicationBus.
 *
 * Translates raw session events into domain events:
 *   - message.part.updated (text content) → messageChunk
 *   - session.updated (title change) → titleChanged
 *   - userMessage events on the bus → session.prompt() (handled by dispatcher)
 *
 * Returns an unsubscribe function. Call it to stop publishing.
 */

import type { DirectHarnessSession, DirectHarnessSessionEvent } from '../entities/direct-harness-session.js';
import type { HarnessReplicationBus } from '../ports/replication-bus.js';

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface WireSessionToBusDeps {
  readonly session: DirectHarnessSession;
  readonly bus: HarnessReplicationBus;
  readonly harnessSessionRowId: string;
  readonly chunkExtractor: (event: DirectHarnessSessionEvent) => string | null;
}

// ─── Use case function ────────────────────────────────────────────────────────

/**
 * Subscribe to session events and publish translated domain events to the bus.
 *
 * Returns an unsubscribe function — call when the session is closed.
 */
export function wireSessionToBus(deps: WireSessionToBusDeps): () => void {
  throw new Error('Not implemented');
}
