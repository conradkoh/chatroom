/**
 * Daemon Utilities — shared helpers for the daemon command module.
 */

/**
 * Format timestamp for daemon log output.
 */
export function formatTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}
