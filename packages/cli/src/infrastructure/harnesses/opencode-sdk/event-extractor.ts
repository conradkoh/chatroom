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
 *     SDK-v1-style delta field. All deltas are passed through — deduplication
 *     is handled at the session level (HTTP response emission is skipped when
 *     SSE already delivered events).
 *   - message.part.delta: looks up the partType from the map and returns an
 *     ExtractedChunk; defaults to 'text' if the mapping is not yet known.
 *   - All other event types: returns null.
 */
export function createOpencodeSdkChunkExtractor(): (
  event: DirectHarnessSessionEvent
) => ExtractedChunk | null {
  /** Maps partID → { messageId, partType } built from message.part.updated events. */
  const partMap = new Map<string, { messageId: string; partType: 'text' | 'reasoning' }>();

  return function extract(event: DirectHarnessSessionEvent): ExtractedChunk | null {
    if (event.type === 'message.part.updated') {
      return handlePartUpdated(
        event.payload as
          | { part?: { id?: string; messageID?: string; type?: string }; delta?: string }
          | undefined,
        partMap
      );
    }

    if (event.type === 'message.part.delta') {
      return handlePartDelta(
        event.payload as { partID?: string; messageID?: string; delta?: string } | undefined,
        partMap
      );
    }

    return null;
  };
}

function resolvePartType(
  part: { id?: string; messageID?: string; type?: string } | undefined
): 'text' | 'reasoning' {
  return part?.type === 'reasoning' ? 'reasoning' : 'text';
}

function handlePartUpdated(
  payload:
    | { part?: { id?: string; messageID?: string; type?: string }; delta?: string }
    | undefined,
  partMap: Map<string, { messageId: string; partType: 'text' | 'reasoning' }>
): ExtractedChunk | null {
  const part = payload?.part;
  if (!part?.id || !part?.messageID) return null;

  const partType = resolvePartType(part);
  partMap.set(part.id, { messageId: part.messageID, partType });

  const delta = payload?.delta;
  if (!delta || delta.length === 0) return null;

  return { content: delta, messageId: part.messageID, partType };
}

function handlePartDelta(
  payload: { partID?: string; messageID?: string; delta?: string } | undefined,
  partMap: Map<string, { messageId: string; partType: 'text' | 'reasoning' }>
): ExtractedChunk | null {
  const delta = payload?.delta;
  if (!delta) return null;

  const messageId = payload?.messageID;
  if (!messageId) return null;

  const partType = partTypeFromPayload(payload?.partID, partMap);

  return { content: delta, messageId, partType };
}

function partTypeFromPayload(
  partID: string | undefined,
  partMap: Map<string, { messageId: string; partType: 'text' | 'reasoning' }>
): 'text' | 'reasoning' {
  return (partID ? partMap.get(partID)?.partType : undefined) ?? 'text';
}
