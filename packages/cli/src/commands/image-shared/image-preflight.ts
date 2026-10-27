/**
 * Shared image preflight helpers.
 *
 * `slice-image` and `remove-image-background` both validate PNG bytes, name
 * outputs, hash files, and preflight overwrites. These helpers are fal-free and
 * filesystem-light so both commands stay offline and testable with fakes.
 */

import { createHash } from 'node:crypto';

import type { PathStatus } from './output-files.js';

/** Filesystem identity used to compare paths across case and symlink aliases. */
export interface FileIdentity {
  dev: number;
  ino: number;
}

/** The filesystem probes `findOutputConflicts` needs from a command's deps. */
export interface OutputConflictDeps {
  pathStatus: (path: string) => Promise<PathStatus>;
  /** Identity via `stat` (symlinks resolved); null when the path is missing. */
  fileIdentity: (path: string) => Promise<FileIdentity | null>;
  /** True when the path itself is a symlink, including a dangling one. */
  isSymlink: (path: string) => Promise<boolean>;
}

export const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;
export const MAX_SOURCE_PIXELS = 100_000_000;
export const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
/** generate-image sidecars are small; anything larger is ignored as unreadable. */
export const MAX_SIDECAR_BYTES = 1024 * 1024;

/** PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A. */
const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Median of a non-empty numeric sample. Odd lengths take the middle value;
 * even lengths average the two middle values and round to an integer.
 */
// fallow-ignore-next-line complexity
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

export function hasPngMagic(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_MAGIC.length) return false;
  return PNG_MAGIC.every((byte, index) => bytes[index] === byte);
}

/**
 * Read width and height from the PNG IHDR chunk without decoding pixels.
 *
 * pngjs allocates from the declared dimensions before any of our checks run,
 * so a hostile image could be a decompression bomb. This header read lets the
 * caller refuse oversized images before handing bytes to the decoder.
 * Returns null when the bytes are too short or do not start with IHDR.
 */
// fallow-ignore-next-line complexity
export function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  // 8 magic bytes + 4 length bytes + 4 type bytes + 8 dimension bytes.
  if (bytes.length < 24) return null;
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export interface OutputConflict {
  path: string;
  reason: string;
}

/** Format every conflict at once, capped so one noisy directory stays readable. */
export function formatConflicts(conflicts: OutputConflict[]): string {
  const shown = conflicts.slice(0, 10);
  const lines = shown.map((conflict) => `- ${conflict.path}: ${conflict.reason}`);
  if (conflicts.length > shown.length) {
    lines.push(`- and ${conflicts.length - shown.length} more`);
  }
  return `Refusing to write ${conflicts.length} output file(s):\n${lines.join('\n')}\nPass --force to overwrite.`;
}

/**
 * Preflight every output path before any write. Directories, symbolic links,
 * paths that resolve to a source file, and existing files without `force` are
 * all conflicts. Identity checks use `stat`, so a case variant, hard link, or
 * symlinked directory cannot overwrite a source.
 */
// fallow-ignore-next-line complexity
export async function findOutputConflicts(
  deps: OutputConflictDeps,
  paths: string[],
  sourcePaths: ReadonlySet<string>,
  sourceIdentities: readonly (FileIdentity | null)[],
  force: boolean
): Promise<OutputConflict[]> {
  const matchesSourceIdentity = (identity: FileIdentity): boolean =>
    sourceIdentities.some(
      (source) => source !== null && source.dev === identity.dev && source.ino === identity.ino
    );

  const conflicts: OutputConflict[] = [];
  for (const path of paths) {
    if (sourcePaths.has(path)) {
      conflicts.push({ path, reason: 'this is the source sheet or its manifest' });
      continue;
    }
    if (await deps.isSymlink(path)) {
      conflicts.push({ path, reason: 'this is a symbolic link' });
      continue;
    }
    const status = await deps.pathStatus(path);
    if (status === 'directory') {
      conflicts.push({ path, reason: 'a directory is in the way' });
      continue;
    }
    const identity = await deps.fileIdentity(path);
    if (identity !== null && matchesSourceIdentity(identity)) {
      conflicts.push({ path, reason: 'this resolves to the source sheet or its manifest' });
      continue;
    }
    if (status === 'file' && !force) {
      conflicts.push({ path, reason: 'already exists' });
    }
  }
  return conflicts;
}
