/**
 * Extracts incremental text content from opencode SDK session events.
 *
 * Call createOpencodeSdkChunkExtractor() once per session to get a stateful
 * extractor. Each session MUST have its own instance — the internal partID map
 * is not safe to share across sessions.
 *
 * The opencode SDK emits two event types that carry text:
 *   - message.part.delta   → streaming delta (SDK v2); carries partID + delta
 *                            but NOT the part type.
 *   - message.part.updated → full part state (both SDK versions); carries the
 *                            complete Part object with its type.
 *
 * Because message.part.delta does not include the part type, the extractor
 * maintains a partID → { messageId, partType } map built from
 * message.part.updated events, and uses it to tag each delta correctly.
 */

import type { DirectHarnessSessionEvent } from '../../../domain/direct-harness/entities/direct-harness-session.js';
import type { ExtractedChunk } from '../../../domain/direct-harness/usecases/open-session.js';

export type { ExtractedChunk };

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a stateful chunk extractor bound to a single session.
 *
 * Returned function behaviour:
 *   - message.part.updated: records partID → { messageId, partType } in an
 *     internal map; also returns an ExtractedChunk when the event carries an
 *     SDK-v1-style delta field.
 *   - message.part.delta: looks up the partType from the map and returns an
 *     ExtractedChunk; defaults to 'text' if the mapping is not yet known.
 *   - All other event types: returns null.
 */
export function createOpencodeSdkChunkExtractor(): (event: DirectHarnessSessionEvent) => ExtractedChunk | null {
  /** Maps partID → { messageId, partType } built from message.part.updated events. */
  const partMap = new Map<string, { messageId: string; partType: 'text' | 'reasoning' }>();
  /** Tracks partIDs already extracted to avoid duplicates when both SSE and HTTP-response
   * events arrive for the same part. Only used for message.part.updated (full state). */
  const emittedPartIds = new Set<string>();

  return function extract(event: DirectHarnessSessionEvent): ExtractedChunk | null {
    // ── message.part.updated ─────────────────────────────────────────────────
    // Fired when a part is created or its state changes. Contains the full Part
    // object (id, messageID, type). We use this to populate our partID map so
    // subsequent message.part.delta events can be tagged correctly.
    //
    // SDK v1 also piggy-backs a `delta` field on this event; we extract it here
    // for backwards compatibility.
    if (event.type === 'message.part.updated') {
      const payload = event.payload as {
        part?: { id?: string; messageID?: string; type?: string };
        delta?: string;
      } | undefined;

      const part = payload?.part;
      if (part?.id && part?.messageID) {
        const partType: 'text' | 'reasoning' =
          part.type === 'reasoning' ? 'reasoning' : 'text';
        partMap.set(part.id, { messageId: part.messageID, partType });

        // SDK v1 compat: extract delta when present on the same event
        const delta = payload?.delta;
        if (delta && delta.length > 0) {
          // Deduplicate: skip parts already extracted (prevents SSE + HTTP response duplicates)
          if (emittedPartIds.has(part.id)) return null;
          emittedPartIds.add(part.id);
          return { content: delta, messageId: part.messageID, partType };
        }
      }
      return null;
    }

    // ── message.part.delta ───────────────────────────────────────────────────
    // Primary streaming event in SDK v2. Carries partID + delta but NOT the
    // part type — resolved via the map populated above.
    if (event.type === 'message.part.delta') {
      const payload = event.payload as {
        partID?: string;
        messageID?: string;
        delta?: string;
      } | undefined;

      const delta = payload?.delta;
      if (!delta || delta.length === 0) return null;

      const messageId = payload?.messageID;
      if (!messageId) return null;

      // Resolve part type from the map. If message.part.updated has not yet
      // arrived for this partID (rare race), default to 'text' so no content
      // is silently dropped.
      const partID = payload?.partID;
      const partType: 'text' | 'reasoning' =
        (partID ? partMap.get(partID)?.partType : undefined) ?? 'text';

      return { content: delta, messageId, partType };
    }

    return null;
  };
}
