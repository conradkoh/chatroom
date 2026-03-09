/**
 * Intentional Stop Tracking
 *
 * Tracks agent keys (chatroomId:role) that are being intentionally stopped,
 * so the onExit handler can distinguish intentional stops from crashes
 * and skip crash recovery accordingly.
 *
 * Extracted into its own module for testability and reuse.
 */

import type { StopReason } from './stop-reason.js';

/**
 * Map from agentKey → pending stop reason.
 * Key format: "chatroomId:role" (role lowercased).
 */
const pendingStops = new Map<string, StopReason>();

/**
 * Build a unique key for an agent in a chatroom.
 * Role is lowercased for case-insensitive matching.
 */
export function agentKey(chatroomId: string, role: string): string {
  return `${chatroomId}:${role.toLowerCase()}`;
}

/**
 * Mark an agent as being stopped with the given reason.
 * Call this before sending SIGTERM so the onExit handler can check.
 * Defaults to 'user.stop' (user-initiated stop).
 */
export function markIntentionalStop(
  chatroomId: string,
  role: string,
  reason: StopReason = 'user.stop'
): void {
  pendingStops.set(agentKey(chatroomId, role), reason);
}

/**
 * Consume the pending stop reason for an agent.
 * Returns the reason if found and removes it, or null if not found (= unexpected exit).
 */
export function consumeIntentionalStop(chatroomId: string, role: string): StopReason | null {
  const key = agentKey(chatroomId, role);
  const reason = pendingStops.get(key) ?? null;
  if (reason !== null) {
    pendingStops.delete(key);
  }
  return reason;
}

/**
 * Remove the pending stop marker without consuming it as "handled".
 * Used to clean up when a stop command fails (e.g., ESRCH).
 */
export function clearIntentionalStop(chatroomId: string, role: string): void {
  pendingStops.delete(agentKey(chatroomId, role));
}

/**
 * Check if an agent has a pending stop marker (without consuming).
 * Useful for testing/debugging.
 */
export function isMarkedForIntentionalStop(chatroomId: string, role: string): boolean {
  return pendingStops.has(agentKey(chatroomId, role));
}

/**
 * Reset all pending stop tracking. Primarily for testing.
 */
export function resetIntentionalStops(): void {
  pendingStops.clear();
}
