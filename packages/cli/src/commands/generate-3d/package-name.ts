/**
 * Generate 3D — the package base name.
 *
 * A package is written as `<base>.zip` and `<base>.html` beside the master GLB.
 * `<base>` is the master's own stem plus a UTC timestamp, so `--out` alone sets
 * both the folder and the name, and consecutive runs still never collide.
 *
 * The stem comes from a path the user chose, so it is sanitised before use and
 * the result is validated as a portable file name.
 */

import { Generate3dError } from './model-registry.js';

/** A portable file name: starts alphanumeric, then alphanumerics, dot, dash, underscore. */
const SAFE_BASE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Make a stem safe for a file name.
 *
 * Everything outside the portable set collapses to `-`, and a leading
 * non-alphanumeric is dropped so `_tmp` and `.hidden` cannot produce a hidden or
 * flag-like file. An all-non-ASCII name sanitises to an empty string, which the
 * caller reports as an unusable `--out`.
 *
 * This is how `--out "My Chest.glb"` becomes `My-Chest-<timestamp>`.
 */
function sanitizeNamePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '');
}

/**
 * UTC `YYYYMMDD-HHmmss`.
 *
 * UTC keeps the rendered name identical on every machine; a local timestamp
 * would make the same run produce a different name depending on the timezone.
 */
export function formatTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

export interface PackageBaseNameArgs {
  /** Basename of `--out` without its `.glb` suffix. */
  stem: string;
  /** UTC `YYYYMMDD-HHmmss`, taken once before the fal call. */
  timestamp: string;
}

/**
 * `<sanitised stem>-<timestamp>`, the base shared by the zip and the preview.
 *
 * Throws when the stem cannot form a file name (for example a name written
 * entirely in a non-ASCII script); the message names the `--out` file so the
 * user knows which argument to change.
 */
export function packageBaseName(args: PackageBaseNameArgs): string {
  const base = `${sanitizeNamePart(args.stem)}-${args.timestamp}`;
  if (!SAFE_BASE_NAME.test(base)) {
    throw new Generate3dError(
      `The output file name "${args.stem}" cannot form a package name ("${base}"). Rename --out so its name uses letters, digits, dot, dash, or underscore, and starts with a letter or digit.`
    );
  }
  return base;
}
