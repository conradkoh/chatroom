/**
 * Generate 3D — deterministic zip writer for the package.
 *
 * Entry order is sorted and every entry gets one fixed timestamp, so the same
 * entries always compress to the same bytes. `fflate` reads the date through the
 * local getters, so `new Date(2020, 0, 1)` always writes 2020-01-01 00:00 in the
 * archive header, whatever the machine's timezone is.
 */

import { zipSync } from 'fflate';

export interface ZipEntry {
  /** Path inside the archive, using forward slashes. */
  path: string;
  bytes: Uint8Array;
}

/** Fixed mtime for every entry: 2020-01-01 00:00:00 local time. */
const ZIP_MTIME = new Date(2020, 0, 1, 0, 0, 0);

/** Deflate level; 6 is the usual size/speed balance for a one-shot archive. */
const ZIP_LEVEL = 6;

/** Byte-order comparison, so sorting does not depend on the host locale. */
function comparePaths(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Build the archive from the given entries.
 *
 * Entries are sorted by path before compression, so the same files always
 * produce the same bytes regardless of the order the caller collected them.
 */
export function zipPackage(entries: readonly ZipEntry[]): Uint8Array {
  const sorted = [...entries].sort((left, right) => comparePaths(left.path, right.path));
  const files: Record<string, [Uint8Array, { mtime: Date; level: 6 }]> = {};
  for (const entry of sorted) {
    files[entry.path] = [entry.bytes, { mtime: ZIP_MTIME, level: ZIP_LEVEL }];
  }
  return zipSync(files);
}
