/**
 * File tree scanner for workspace directories.
 *
 * Uses a filesystem walk for every workspace and interprets root/nested
 * `.gitignore`, root `.cursorignore`, and git extra excludes directly. Git is never invoked, so
 * ordinary folders and repositories use the same discovery path.
 */

import type {
  FileTree,
  FileTreeEntry,
} from '@workspace/backend/src/domain/entities/workspace-files.js';

import { compareRankedFiles, countDataFilesByParent, scoreFile } from './file-tree-sync-ranker.js';
import { walkWorkspaceFiles } from './workspace-file-walk.js';
import { hasExcludedDirSegment } from './workspace-visibility-policy.js';

const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_CANDIDATE_FILE_PATHS = 50_000;

export type ScanOptions = {
  maxEntries?: number;
};

/**
 * Scans the file tree of a workspace directory.
 */
export async function scanFileTree(rootDir: string, options?: ScanOptions): Promise<FileTree> {
  const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const scannedAt = Date.now();

  const walk = await walkWorkspaceFiles(rootDir, { maxFilePaths: DEFAULT_CANDIDATE_FILE_PATHS });
  const filteredPaths = walk.filePaths.filter((p) => !isExcluded(p));
  const filteredStubs = walk.directoryStubs.filter((p) => !isExcluded(p));
  const entries = buildEntries(filteredPaths, filteredStubs, maxEntries);

  return {
    entries,
    scannedAt,
    rootDir,
  };
}

/** Check if a path contains an always-excluded directory segment. */
// fallow-ignore-next-line unused-export
export function isExcluded(filePath: string): boolean {
  return hasExcludedDirSegment(filePath);
}

function entryDepth(entryPath: string): number {
  return entryPath.split('/').length;
}

/**
 * Build FileTreeEntry array from file paths and explicit directory stubs.
 * Caps entries using sync ranking while retaining ancestors and directory stubs.
 */
// fallow-ignore-next-line unused-export complexity
export function buildEntries(
  filePaths: string[],
  directoryStubs: string[],
  maxEntries: number
): FileTreeEntry[] {
  const selected = new Map<string, FileTreeEntry>();
  const data = countDataFilesByParent(filePaths);
  const ranked = [...filePaths].sort((a, b) =>
    compareRankedFiles(a, scoreFile(a, data), b, scoreFile(b, data))
  );
  for (const file of ranked) {
    const parts = file.split('/');
    const needed = [file, ...parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))];
    const missing = needed.filter((p) => !selected.has(p));
    if (selected.size + missing.length > maxEntries) continue;
    for (const p of needed) selected.set(p, { path: p, type: p === file ? 'file' : 'directory' });
  }

  for (const dir of [...directoryStubs].sort(
    (a, b) => entryDepth(a) - entryDepth(b) || a.localeCompare(b)
  )) {
    if (selected.has(dir)) continue;
    if (selected.size >= maxEntries) break;
    selected.set(dir, { path: dir, type: 'directory' });
  }

  return Array.from(selected.values()).sort((left, right) => {
    const depthDelta = entryDepth(left.path) - entryDepth(right.path);
    if (depthDelta !== 0) return depthDelta;
    return left.path.localeCompare(right.path);
  });
}
