import type { DirectHarnessSessionEvent } from '../../../../domain/entities/direct-harness-session.js';
import type { ExtractedChunk } from '../../../../domain/entities/turn-chunk.js';

/**
 * Chunk extractor for harness sessions that emit normalized `message.part.delta`
 * events with `{ messageID, delta, partType? }` payloads.
 */
export function createStandardSdkChunkExtractor(): (
  event: DirectHarnessSessionEvent
) => ExtractedChunk | null {
  // fallow-ignore-next-line complexity
  return function extract(event: DirectHarnessSessionEvent): ExtractedChunk | null {
    if (event.type !== 'message.part.delta') return null;

    const payload = event.payload as {
      messageID?: string;
      delta?: string;
      partType?: 'text' | 'reasoning';
    };

    const delta = payload?.delta;
    if (!delta || delta.length === 0) return null;

    const messageId = payload?.messageID;
    if (!messageId) return null;

    return {
      content: delta,
      messageId,
      partType: payload?.partType ?? 'text',
    };
  };
}
