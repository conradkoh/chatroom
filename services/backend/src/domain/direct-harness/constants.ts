/**
 * Shared constants for the direct-harness system.
 */

/** Default timeout (in ms) for the buffered journal flush interval. */
export const DEFAULT_FLUSH_INTERVAL = 500;

/** Default harness name used when no capabilities are published yet. */
export const DEFAULT_HARNESS_NAME = 'pi-sdk';

/** Terminal session statuses — once reached, the session cannot transition. */
export const TERMINAL_STATUSES: readonly string[] = ['closed', 'failed'];

/** Statuses where user input is blocked. */
export const BLOCKED_STATUSES: readonly string[] = ['pending', 'spawning', 'closed', 'failed'];
