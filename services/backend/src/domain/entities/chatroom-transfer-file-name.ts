/**
 * Chatroom transfer file names (pure module).
 *
 * One source for the CLI and, later, the browser. Both names are UTC, second-precision
 * and colon-free, which keeps them sortable and legal on Windows.
 */

/**
 * `YYYYMMDDTHHMMSSZ` in UTC with no colons, safe on Windows.
 *
 * Exported because the bundle name below is a thin wrapper over it and the browser
 * (which shares this module in a later phase) may need the raw stamp.
 */
// fallow-ignore-next-line unused-export
export function transferTimestamp(at: Date): string {
  return at.toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z';
}

/** `chatroom-all-<machineId>-YYYYMMDDTHHMMSSZ.json`; machine id characters outside `[A-Za-z0-9_-]` become `_`. */
export function bundleFileName(machineId: string, at: Date): string {
  const safe = machineId.replace(/[^A-Za-z0-9_-]/g, '_');
  return `chatroom-all-${safe}-${transferTimestamp(at)}.json`;
}
