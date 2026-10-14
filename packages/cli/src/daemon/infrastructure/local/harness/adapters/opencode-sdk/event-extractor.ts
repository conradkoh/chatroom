/**
 * Extracts incremental text content from opencode V2 session events.
 *
 * Call createOpencodeSdkChunkExtractor() once per session to get a stateful
 * extractor. Each session MUST have its own instance.
 *
 * OpenCode V2 emits granular streaming events that carry their part type
 * directly, so no partID → type map is required:
 *   - session.text.delta      → assistant text (payload.delta)
 *   - session.reasoning.delta → reasoning text (payload.delta)
 */

import type { DirectHarnessSessionEvent } from '../../../../../domain/entities/direct-harness-session.js';
import type { ExtractedChunk } from '../../../../../domain/entities/turn-chunk.js';

export type { ExtractedChunk };

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a stateful chunk extractor bound to a single session.
 *
 * Returned function behaviour:
 *   - session.text.delta: returns a text chunk from `payload.delta`.
 *   - session.reasoning.delta: returns a reasoning chunk from `payload.delta`.
 *   - All other event types: returns null.
 */
export function createOpencodeSdkChunkExtractor(): (
  event: DirectHarnessSessionEvent
) => ExtractedChunk | null {
  return function extract(event: DirectHarnessSessionEvent): ExtractedChunk | null {
    if (event.type !== 'session.text.delta' && event.type !== 'session.reasoning.delta') {
      return null;
    }

    const payload = event.payload as
      { assistantMessageID?: string | undefined; delta?: string | undefined } | undefined;

    const delta = payload?.delta;
    if (!delta || delta.length === 0) return null;

    const messageId = payload?.assistantMessageID;
    if (!messageId) return null;

    const partType: 'text' | 'reasoning' =
      event.type === 'session.reasoning.delta' ? 'reasoning' : 'text';

    return { content: delta, messageId, partType };
  };
}
