/**
 * File tree scanner for workspace directories.
 *
 * Uses filesystem walk for all workspaces. In git repos, ignore rules come from
 * `git check-ignore`; otherwise `.gitignore` / `.cursorignore` are parsed.
 * This traverses submodule directories on disk (unlike `git ls-files`).
 */

import type {
  FileTree,
  FileTreeEntry,
} from '@workspace/backend/src/domain/entities/workspace-files.js';

import { walkWorkspaceFiles } from './workspace-file-walk.js';
import { hasExcludedDirSegment } from './workspace-visibility-policy.js';

const DEFAULT_MAX_ENTRIES = 10_000;

export type ScanOptions = {
  maxEntries?: number;
};

/**
 * Scans the file tree of a workspace directory.
 */
export async function scanFileTree(rootDir: string, options?: ScanOptions): Promise<FileTree> {
  const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const scannedAt = Date.now();

  const walk = await walkWorkspaceFiles(rootDir, { maxFilePaths: maxEntries });
  const filteredPaths = walk.filePaths.filter((p) => !isExcluded(p));
  const entries = buildEntries(filteredPaths, maxEntries);

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

/**
 * Build FileTreeEntry array from file paths.
 * Derives directory entries from the file paths.
 * Caps at maxEntries total (files + directories).
 */
// fallow-ignore-next-line unused-export complexity
export function buildEntries(filePaths: string[], maxEntries: number): FileTreeEntry[] {
  const directories = new Set<string>();
  for (const filePath of filePaths) {
    const parts = filePath.split('/');
    for (let i = 1; i < parts.length; i++) {
      directories.add(parts.slice(0, i).join('/'));
    }
  }

  const entries: FileTreeEntry[] = [];

  const sortedDirs = Array.from(directories).sort();
  for (const dir of sortedDirs) {
    if (entries.length >= maxEntries) break;
    entries.push({ path: dir, type: 'directory' });
  }

  const sortedFiles = filePaths.slice().sort();
  for (const file of sortedFiles) {
    if (entries.length >= maxEntries) break;
    entries.push({ path: file, type: 'file' });
  }

  return entries;
}
