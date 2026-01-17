/**
 * Chatroom CLI Configuration
 *
 * Centralized configuration for CLI behavior, polling intervals, and timeouts.
 */

/** Polling interval for the create command (monitoring chatroom) */
export const CREATE_POLL_INTERVAL_MS = 1000;

/** Polling interval for wait-for-task command */
export const WAIT_POLL_INTERVAL_MS = 500;

/** Default timeout for wait-for-task (10 minutes) */
export const DEFAULT_WAIT_TIMEOUT_MS = 10 * 60 * 1000;

/** Maximum consecutive errors before logging a warning */
export const MAX_SILENT_ERRORS = 5;

/** Maximum messages to fetch for context lookup */
export const MAX_MESSAGES_FOR_CONTEXT = 100;

/** Web server port for dashboard UI */
export const WEB_SERVER_PORT = parseInt(process.env.WEB_PORT || '3456', 10);
