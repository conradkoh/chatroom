/**
 * Chatroom CLI Configuration
 *
 * Centralized configuration for CLI behavior, polling intervals, and timeouts.
 */

/** Polling interval for the create command (monitoring chatroom) */
export const CREATE_POLL_INTERVAL_MS = 1000;

/** Default active work timeout (1 hour) - how long an active agent has before being considered crashed */
export const DEFAULT_ACTIVE_TIMEOUT_MS = 60 * 60 * 1000;

/** Maximum messages to fetch for context lookup */
export const MAX_MESSAGES_FOR_CONTEXT = 100;

/** Web server port for dashboard UI */
export const WEB_SERVER_PORT = parseInt(process.env.WEB_PORT || '3456', 10);
