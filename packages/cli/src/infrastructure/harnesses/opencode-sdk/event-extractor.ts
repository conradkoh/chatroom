/**
 * Extracts text content from opencode SDK harness session events.
 *
 * Returns the text for message.part.updated events, and null for all others
 * (tool calls, status updates, etc.). Callers use this as the chunkExtractor
 * in openSession / resumeSession deps.
 */

import type { DirectHarnessSessionEvent } from '../../../domain/direct-harness/entities/direct-harness-session.js';

/**
 * Extracts text content from a DirectHarnessSessionEvent.
 * Returns the text string for content events, or null if the event
 * does not carry displayable content.
 */
export function opencodeSdkChunkExtractor(event: DirectHarnessSessionEvent): string | null {
  if (event.type === 'message.part.updated') {
    const payload = event.payload as { content?: string } | undefined;
    const text = payload?.content;
    if (text && text.length > 0) {
      return text;
    }
  }
  return null;
}
