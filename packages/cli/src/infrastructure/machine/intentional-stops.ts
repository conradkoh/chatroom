/**
 * Intentional Stop Tracking
 *
 * Tracks agent keys (chatroomId:role) that are being intentionally stopped,
 * so the onExit handler can distinguish intentional stops from crashes
 * and skip crash recovery accordingly.
 *
 * Extracted into its own module for testability and reuse.
 */

/**
 * Set of agent keys currently being intentionally stopped.
 * Keys are in the format "chatroomId:role" (role lowercased).
 */
const intentionalStops = new Set<string>();

/**
 * Build a unique key for an agent in a chatroom.
 * Role is lowercased for case-insensitive matching.
 */
export function agentKey(chatroomId: string, role: string): string {
  return `${chatroomId}:${role.toLowerCase()}`;
}

/**
 * Mark an agent as being intentionally stopped.
 * Call this before sending SIGTERM so the onExit handler can check.
 */
export function markIntentionalStop(chatroomId: string, role: string): void {
  intentionalStops.add(agentKey(chatroomId, role));
}

/**
 * Check whether an agent exit was intentional.
 * If the key is found, it is removed (consumed) and returns true.
 * If not found, returns false (indicating a crash/unexpected exit).
 */
export function consumeIntentionalStop(chatroomId: string, role: string): boolean {
  const key = agentKey(chatroomId, role);
  if (intentionalStops.has(key)) {
    intentionalStops.delete(key);
    return true;
  }
  return false;
}

/**
 * Remove the intentional stop marker without consuming it as "handled".
 * Used to clean up when a stop command fails (e.g., ESRCH).
 */
export function clearIntentionalStop(chatroomId: string, role: string): void {
  intentionalStops.delete(agentKey(chatroomId, role));
}

/**
 * Check if an agent is marked for intentional stop (without consuming).
 * Useful for testing/debugging.
 */
export function isMarkedForIntentionalStop(chatroomId: string, role: string): boolean {
  return intentionalStops.has(agentKey(chatroomId, role));
}

/**
 * Reset all intentional stop tracking. Primarily for testing.
 */
export function resetIntentionalStops(): void {
  intentionalStops.clear();
}
