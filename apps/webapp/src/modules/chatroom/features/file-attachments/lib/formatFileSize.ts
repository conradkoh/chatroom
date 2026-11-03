/**
 * Human-readable sizes for file attachments.
 *
 * Sizes are binary (1024-based) and match the shared attachment registry's
 * limits, so "10 MB" reads the same here and in the backend error copy.
 */

// fallow-ignore-next-line unused-export
export const BYTES_PER_MB = 1024 * 1024;

const BYTES_PER_KB = 1024;
const BYTES_PER_GB = 1024 * BYTES_PER_MB;

/** Drops a trailing `.0` so whole units read "1 MB" rather than "1.0 MB". */
function dropTrailingZero(value: string): string {
  return value.endsWith('.0') ? value.slice(0, -2) : value;
}

/** Formats a byte count as `0 B`, `512 B`, `1.5 KB`, `256 MB`, or `1 GB`. */
export function formatFileSize(bytes: number): string {
  if (bytes < BYTES_PER_KB) return `${bytes} B`;
  if (bytes < BYTES_PER_MB) {
    return `${dropTrailingZero((bytes / BYTES_PER_KB).toFixed(1))} KB`;
  }
  if (bytes < BYTES_PER_GB) {
    return `${dropTrailingZero((bytes / BYTES_PER_MB).toFixed(1))} MB`;
  }
  return `${dropTrailingZero((bytes / BYTES_PER_GB).toFixed(1))} GB`;
}

/** Uppercased extension for a filename's meta line; `FILE` when absent. */
export function fileExtensionLabel(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === filename.length - 1) return 'FILE';
  return filename.slice(dotIndex + 1).toUpperCase();
}
