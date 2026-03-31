/**
 * ChatroomForwarder — abstraction for delivering messages to the chatroom backend.
 *
 * Implementations may use Convex HTTP API, direct Convex client calls, or
 * a simple callback for testing. The bridge consumes this interface without
 * being coupled to any specific transport.
 */

import type { PlatformMessage } from './types.js';

// ─── Forwarder Interface ──────────────────────────────────────────────────────

/** Metadata about the integration context for outbound forwarding. */
export interface ForwarderContext {
  /** The chatroom ID in the Convex backend */
  chatroomId: string;
  /** The platform name (e.g. "telegram") */
  platform: string;
}

/**
 * Interface for forwarding platform messages into the chatroom backend.
 *
 * Implementations should handle:
 * - Authentication with the backend
 * - Mapping PlatformMessage fields to the backend's expected format
 * - Error handling / retries
 */
export interface ChatroomForwarder {
  /**
   * Forward a message from an external platform into the chatroom.
   * Called by the bridge whenever a platform message arrives.
   */
  forward(message: PlatformMessage, context: ForwarderContext): Promise<void>;
}

// ─── Callback-based Forwarder ─────────────────────────────────────────────────

/** A simple forwarding function signature for lightweight use cases. */
export type ForwardFn = (message: PlatformMessage, context: ForwarderContext) => void | Promise<void>;

/**
 * Create a ChatroomForwarder from a plain callback function.
 *
 * Useful for testing or simple integrations where a full class is overkill.
 *
 * @example
 * ```ts
 * const forwarder = createCallbackForwarder(async (msg, ctx) => {
 *   await fetch(`${CONVEX_URL}/api/messages`, {
 *     method: 'POST',
 *     body: JSON.stringify({ chatroomId: ctx.chatroomId, text: msg.text }),
 *   });
 * });
 * ```
 */
export function createCallbackForwarder(fn: ForwardFn): ChatroomForwarder {
  return {
    async forward(message, context) {
      await fn(message, context);
    },
  };
}

// ─── No-op Forwarder (for development/testing) ───────────────────────────────

/**
 * A forwarder that does nothing. Useful as a default or in tests.
 */
export const noopForwarder: ChatroomForwarder = {
  async forward() {
    // intentionally empty
  },
};
