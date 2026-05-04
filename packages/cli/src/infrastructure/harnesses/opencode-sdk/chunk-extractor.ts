/**
 * Extracts text content from opencode-sdk harness events for the message stream.
 *
 * Only 'message.part.updated' events with a text or reasoning part are extracted;
 * all other events (tool calls, session status, etc.) return null.
 */

import type { DirectHarnessSessionEvent } from '../../../domain/direct-harness/index.js';

interface MessagePartProps {
  part?: {
    type?: string;
    text?: string;
    /** opencode SDK sessionID — present on every Part variant. Used for routing; not consumed here. */
    sessionID?: string;
  };
  delta?: string;
}

/**
 * Returns the text content for a harness event, or null if the event
 * carries no user-visible text (e.g. tool-call events, session.idle, etc.).
 *
 * Mirrors the narrowing logic in SessionEventForwarder:
 * - Prefer `delta` if non-empty (streaming incremental chunk)
 * - Fall back to `part.text` for completed parts
 */
export function openCodeChunkExtractor(event: DirectHarnessSessionEvent): string | null {
  if (event.type !== 'message.part.updated') return null;

  const props = event.payload as MessagePartProps | undefined;
  const part = props?.part;

  if (!part || (part.type !== 'text' && part.type !== 'reasoning')) return null;

  const content =
    props?.delta !== undefined && props.delta !== '' ? props.delta : (part.text ?? '');

  return content !== '' ? content : null;
}
