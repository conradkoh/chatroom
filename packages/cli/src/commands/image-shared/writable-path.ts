/**
 * Shared output-collision preflight for commands that write files.
 *
 * `generate-3d`, `generate-image`, and `remove-image-background` all refuse to
 * clobber an existing file unless the user passed `--force`, and all refuse a
 * directory outright even with `--force`. Returning the message instead of
 * throwing lets every command raise its own error class.
 */

import type { PathStatus } from './output-files.js';

/** The one filesystem probe these checks need. */
export interface WritablePathDeps {
  pathStatus: (path: string) => Promise<PathStatus>;
}

/** One path the command is about to write, with the name the error shows. */
export interface WritableTarget {
  path: string;
  label: string;
  /** Replaces the default `--force` advice, for example on a package collision. */
  hint?: string | undefined;
}

/** Advice shown when an existing file blocks the write. */
const OVERWRITE_HINT = 'Pass --force to overwrite.';

/**
 * Advice for a collision met while planning. The refusal is correct — a real
 * run would refuse too — but "pass --force to overwrite" is misleading when
 * nothing is written, so a dry run says what `--force` actually buys.
 */
export const DRY_RUN_OVERWRITE_HINT =
  'A real run would also refuse this. Add --force to print the plan; a dry run writes nothing.';

/** Refusal for a directory target; `--force` never rescues it. */
function directoryRefusal(target: WritableTarget): string {
  return `${target.label} is a directory: ${target.path}. Pass a file path.`;
}

/** Refusal for an existing file target when `--force` was not passed. */
function fileRefusal(target: WritableTarget): string {
  return `${target.label} already exists: ${target.path}. ${target.hint ?? OVERWRITE_HINT}`;
}

/** The refusal for one target in this state, or null when it may be written. */
function blockedMessage(target: WritableTarget, status: PathStatus, force: boolean): string | null {
  if (status === 'directory') return directoryRefusal(target);
  if (status === 'file' && !force) return fileRefusal(target);
  return null;
}

/**
 * Return the refusal message for the first blocked target, or null when every
 * target is writable. Target order decides which problem the user sees first.
 */
export async function findUnwritablePathMessage(
  deps: WritablePathDeps,
  targets: readonly WritableTarget[],
  force: boolean
): Promise<string | null> {
  for (const target of targets) {
    const message = blockedMessage(target, await deps.pathStatus(target.path), force);
    if (message !== null) return message;
  }
  return null;
}
