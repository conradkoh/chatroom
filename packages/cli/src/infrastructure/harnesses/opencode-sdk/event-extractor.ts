/**
 * Extracts incremental text content from opencode SDK session events.
 *
 * The SDK emits two event types that carry text:
 *   - message.part.delta  → the primary streaming delta (incremental chunk)
 *   - message.part.updated → updated full part state (may also carry delta)
 *
 * Returns null for all other event types.
 */

import type { DirectHarnessSessionEvent } from '../../../domain/direct-harness/entities/direct-harness-session.js';

export function opencodeSdkChunkExtractor(event: DirectHarnessSessionEvent): string | null {
  // Primary streaming event — incremental text delta
  if (event.type === 'message.part.delta') {
    const payload = event.payload as { delta?: string } | undefined;
    const delta = payload?.delta;
    if (delta && delta.length > 0) return delta;
    return null;
  }

  // Fallback: message.part.updated may carry a delta field on some SDK versions
  if (event.type === 'message.part.updated') {
    const payload = event.payload as {
      part?: { type?: string };
      delta?: string;
    } | undefined;
    if (payload?.part?.type !== 'text') return null;
    const delta = payload.delta;
    if (delta && delta.length > 0) return delta;
  }

  return null;
}
