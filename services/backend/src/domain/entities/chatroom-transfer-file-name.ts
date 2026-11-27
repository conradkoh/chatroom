/**
 * Chatroom transfer file names (pure module).
 *
 * One source for the CLI and, later, the browser: the single-chatroom name has
 * been written by the CLI since the export shipped, so its bytes must not
 * change. Both names are UTC, second-precision and colon-free, which keeps them
 * sortable and legal on Windows.
 */

/**
 * `YYYYMMDDTHHMMSSZ` in UTC with no colons, safe on Windows.
 *
 * Exported because both names below are thin wrappers over it and the browser
 * (which shares this module in a later phase) may need the raw stamp. It has no
 * consumer outside this module today, so the dead-export audit is told that.
 */
// fallow-ignore-next-line unused-export
export function transferTimestamp(at: Date): string {
  return at.toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z';
}

/** `chatroom-<id>-YYYYMMDDTHHMMSSZ.json`. Output identical to the CLI's existing `exportFileName`. */
export function exportFileName(chatroomId: string, at: Date): string {
  return `chatroom-${chatroomId}-${transferTimestamp(at)}.json`;
}

/** `chatroom-all-<machineId>-YYYYMMDDTHHMMSSZ.json`; machine id characters outside `[A-Za-z0-9_-]` become `_`. */
export function bundleFileName(machineId: string, at: Date): string {
  const safe = machineId.replace(/[^A-Za-z0-9_-]/g, '_');
  return `chatroom-all-${safe}-${transferTimestamp(at)}.json`;
}
