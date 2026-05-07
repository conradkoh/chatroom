/**
 * Extracts incremental text content from opencode SDK session events.
 *
 * For message.part.updated events with a text part, returns the `delta`
 * string (the incremental chunk). Returns null for all other event types
 * (tool calls, status updates, etc.).
 */

import type { DirectHarnessSessionEvent } from '../../../domain/direct-harness/entities/direct-harness-session.js';

export function opencodeSdkChunkExtractor(event: DirectHarnessSessionEvent): string | null {
  if (event.type !== 'message.part.updated') return null;

  const payload = event.payload as {
    part?: { type?: string };
    delta?: string;
  } | undefined;

  if (payload?.part?.type !== 'text') return null;

  const delta = payload.delta;
  if (delta && delta.length > 0) return delta;

  return null;
}
