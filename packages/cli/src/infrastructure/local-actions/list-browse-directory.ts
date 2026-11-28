/**
 * Bounded, asynchronous directory listing for remote folder browsing.
 *
 * One call lists exactly one directory: directory names only, each flagged when it is a
 * symlink, plus counts for files and hidden entries. Nothing recurses and nothing blocks.
 *
 * Constraints this module guarantees:
 * - Asynchronous only (`node:fs/promises`, `node:os`); the daemon event loop is never blocked.
 * - Bounded: at most LIST_LIMITS.scanMaxEntries scanned, at most FOLDER_BROWSE_MAX_ENTRIES
 *   returned, at most FOLDER_BROWSE_MAX_NAME_BYTES of UTF-8 name bytes, a 3 s scan budget and a
 *   10 s hard timeout.
 * - Directories only. A symlink is `stat`-ed (at most LIST_LIMITS.symlinkStatMax times) and is
 *   listed only when its target is a directory, flagged `symlink: true`.
 * - Hidden (dot) entries are skipped and counted unless `showHidden`.
 * - A missing path or a non-directory falls back to the nearest existing ancestor; permission
 *   errors are never masked by that fallback.
 * - Every failure becomes a result; the function never rejects.
 */

import { opendir, stat } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { posix } from 'node:path';

import {
  FOLDER_BROWSE_MAX_ENTRIES,
  FOLDER_BROWSE_MAX_ERROR_MESSAGE_LENGTH,
  FOLDER_BROWSE_MAX_NAME_BYTES,
  FOLDER_BROWSE_MAX_NAME_LENGTH,
  folderBrowseNameBytes,
  normalizeBrowsePath,
  type FolderBrowseEntry,
  type FolderBrowseErrorCode,
} from '@workspace/shared/domain/folder-browse';

export interface ListBrowseDirectoryInput {
  /** Absolute POSIX path, or null to start at the daemon user's home directory. */
  path: string | null;
  showHidden: boolean;
  /** Case-insensitive directory-name substring filter, or null for none. */
  filter: string | null;
}

export type ListBrowseDirectoryResult =
  | {
      kind: 'listing';
      path: string;
      parentPath: string | null;
      entries: FolderBrowseEntry[];
      dirCount: number;
      fileCount: number;
      hiddenCount: number;
      complete: boolean;
    }
  | { kind: 'error'; code: FolderBrowseErrorCode; message: string; path: string };

// fallow-ignore-next-line unused-export
export const LIST_LIMITS = {
  scanMaxEntries: 20_000,
  timeBudgetMs: 3_000,
  hardTimeoutMs: 10_000,
  symlinkStatMax: 256,
} as const;

/** Deepest ancestor walk for a path that does not exist. */
const MAX_ANCESTOR_STEPS = 64;

interface ErrorLike {
  code?: string | undefined;
  message?: string | undefined;
}

function errorCode(error: unknown): string | undefined {
  return (error as ErrorLike | null | undefined)?.code;
}

function errorMessage(error: unknown): string {
  const message = (error as ErrorLike | null | undefined)?.message ?? String(error);
  return message.slice(0, FOLDER_BROWSE_MAX_ERROR_MESSAGE_LENGTH);
}

/** EACCES/EPERM are permission errors; every other failure is a read failure. */
function toErrorResult(error: unknown, path: string): ListBrowseDirectoryResult {
  const code = errorCode(error);
  const isPermission = code === 'EACCES' || code === 'EPERM';
  return {
    kind: 'error',
    code: isPermission ? 'PERMISSION_DENIED' : 'READ_FAILED',
    message: errorMessage(error),
    path,
  };
}

function timeoutResult(path: string): ListBrowseDirectoryResult {
  return {
    kind: 'error',
    code: 'TIMEOUT',
    message: `Listing did not finish within ${LIST_LIMITS.hardTimeoutMs} ms`,
    path,
  };
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  (timer as { unref?: () => void }).unref?.();
}

function isMissing(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Deepest existing directory at or above `start`. Permission and read errors are not masked. */
// fallow-ignore-next-line complexity
async function resolveExistingDirectory(
  start: string
): Promise<{ ok: true; path: string } | { ok: false; result: ListBrowseDirectoryResult }> {
  let current = start;
  for (let step = 0; step < MAX_ANCESTOR_STEPS; step += 1) {
    try {
      if ((await stat(current)).isDirectory()) return { ok: true, path: current };
    } catch (error) {
      if (!isMissing(error)) return { ok: false, result: toErrorResult(error, current) };
      if (current === '/') return { ok: false, result: toErrorResult(error, current) };
    }
    if (current === '/') break;
    current = posix.dirname(current);
  }
  return {
    ok: false,
    result: {
      kind: 'error',
      code: 'READ_FAILED',
      message: 'No existing ancestor directory',
      path: start,
    },
  };
}

function isHiddenName(name: string): boolean {
  return name.startsWith('.');
}

/** Natural, case-insensitive order; a codepoint tiebreak keeps the order deterministic. */
function compareEntries(left: FolderBrowseEntry, right: FolderBrowseEntry): number {
  // The options belong in the third argument; `localeCompare(other, { ... })` treats them as a locale.
  const primary = left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
  if (primary !== 0) return primary;
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

interface ScanOutcome {
  entries: FolderBrowseEntry[];
  dirCount: number;
  fileCount: number;
  hiddenCount: number;
  complete: boolean;
}

/** The subset of `fs.Dirent` the scan reads. */
interface DirentLike {
  name: string;
  isDirectory: () => boolean;
  isSymbolicLink: () => boolean;
}

interface ScanState {
  candidates: FolderBrowseEntry[];
  fileCount: number;
  hiddenCount: number;
  symlinkStats: number;
}

/** True when `path` resolves to a directory. A failed stat counts as "not a directory". */
async function isDirectoryPath(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Counts one scanned entry into `state`. Symlinks are stat-ed only within the symlink budget. */
// fallow-ignore-next-line complexity
async function recordEntry(
  dir: string,
  entry: DirentLike,
  showHidden: boolean,
  state: ScanState
): Promise<void> {
  if (!showHidden && isHiddenName(entry.name)) {
    state.hiddenCount += 1;
  } else if (entry.isDirectory()) {
    state.candidates.push({ name: entry.name });
  } else if (entry.isSymbolicLink() && state.symlinkStats < LIST_LIMITS.symlinkStatMax) {
    state.symlinkStats += 1;
    if (await isDirectoryPath(posix.join(dir, entry.name))) {
      state.candidates.push({ name: entry.name, symlink: true });
    } else {
      state.fileCount += 1;
    }
  } else {
    state.fileCount += 1;
  }
}

/** Directory names matching the case-insensitive filter, in natural order. */
function matchingSorted(
  candidates: FolderBrowseEntry[],
  filter: string | null
): FolderBrowseEntry[] {
  const needle = filter !== null && filter.length > 0 ? filter.toLowerCase() : null;
  const matched =
    needle === null
      ? candidates
      : candidates.filter((candidate) => candidate.name.toLowerCase().includes(needle));
  return matched.sort(compareEntries);
}

/** Names that cannot be returned as a directory entry; they are counted as files instead. */
function isUnlistableName(name: string): boolean {
  return name.length > FOLDER_BROWSE_MAX_NAME_LENGTH || name.includes('/');
}

interface CappedEntries {
  entries: FolderBrowseEntry[];
  unlistableCount: number;
}

/** Applies the entry-count and name-byte caps to sorted candidates. */
// fallow-ignore-next-line complexity
function capEntries(sorted: FolderBrowseEntry[]): CappedEntries {
  const entries: FolderBrowseEntry[] = [];
  let nameBytes = 0;
  let unlistableCount = 0;
  for (const candidate of sorted) {
    if (entries.length >= FOLDER_BROWSE_MAX_ENTRIES) break;
    if (isUnlistableName(candidate.name)) {
      unlistableCount += 1;
      continue;
    }
    const entryBytes = folderBrowseNameBytes([candidate]);
    if (nameBytes + entryBytes > FOLDER_BROWSE_MAX_NAME_BYTES) continue;
    entries.push(candidate);
    nameBytes += entryBytes;
  }
  return { entries, unlistableCount };
}

/** One non-recursive read with the scan caps. `null` when the hard timeout aborted it. */
// fallow-ignore-next-line complexity
async function scanDirectory(
  dir: string,
  input: ListBrowseDirectoryInput,
  isAborted: () => boolean
): Promise<ScanOutcome | null> {
  const startedAt = Date.now();
  const state: ScanState = { candidates: [], fileCount: 0, hiddenCount: 0, symlinkStats: 0 };
  let scanned = 0;
  let complete = true;

  const handle = await opendir(dir, { bufferSize: 128 });
  for await (const entry of handle) {
    if (isAborted()) return null;
    await recordEntry(dir, entry, input.showHidden, state);

    scanned += 1;
    const outOfBudget =
      scanned >= LIST_LIMITS.scanMaxEntries || Date.now() - startedAt >= LIST_LIMITS.timeBudgetMs;
    if (outOfBudget) {
      complete = false;
      break;
    }
  }

  const matched = matchingSorted(state.candidates, input.filter);
  const capped = capEntries(matched);
  return {
    entries: capped.entries,
    dirCount: matched.length,
    fileCount: state.fileCount + capped.unlistableCount,
    hiddenCount: state.hiddenCount,
    complete,
  };
}

// fallow-ignore-next-line complexity
async function listOnce(
  input: ListBrowseDirectoryInput,
  isAborted: () => boolean
): Promise<ListBrowseDirectoryResult> {
  const base = input.path ?? homedir();
  if (platform() === 'win32') {
    return {
      kind: 'error',
      code: 'UNSUPPORTED_PLATFORM',
      message: 'Folder browsing requires a POSIX platform',
      path: base,
    };
  }

  let start: string;
  try {
    start = normalizeBrowsePath(base);
  } catch (error) {
    return toErrorResult(error, base);
  }

  const resolved = await resolveExistingDirectory(start);
  if (!resolved.ok) return resolved.result;

  const scan = await scanDirectory(resolved.path, input, isAborted);
  if (scan === null) return timeoutResult(resolved.path);

  return {
    kind: 'listing',
    path: resolved.path,
    parentPath: resolved.path === '/' ? null : posix.dirname(resolved.path),
    entries: scan.entries,
    dirCount: scan.dirCount,
    fileCount: scan.fileCount,
    hiddenCount: scan.hiddenCount,
    complete: scan.complete,
  };
}

/** Lists one directory for a remote browse request. Never rejects. */
export async function listBrowseDirectory(
  input: ListBrowseDirectoryInput
): Promise<ListBrowseDirectoryResult> {
  const base = input.path ?? homedir();
  let aborted = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const timeout = new Promise<ListBrowseDirectoryResult>((resolve) => {
    const handle = setTimeout(() => {
      aborted = true;
      resolve(timeoutResult(base));
    }, LIST_LIMITS.hardTimeoutMs);
    unrefTimer(handle);
    timer = handle;
  });

  try {
    return await Promise.race([
      listOnce(input, () => aborted).catch((error: unknown) => toErrorResult(error, base)),
      timeout,
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
