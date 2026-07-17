/**
 * File tree scanner for workspace directories.
 *
 * Uses a filesystem walk for every workspace and interprets root/nested
 * `.gitignore` plus root `.cursorignore` directly. Git is never invoked, so
 * ordinary folders and repositories use the same discovery path.
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
 * Caps at maxEntries total (files + directories), preferring shallower paths first
 * so root-level files like `.drone.yml` are not crowded out by deep directories.
 */
// fallow-ignore-next-line unused-export complexity
export function buildEntries(
  filePaths: string[],
  directoryStubs: string[],
  maxEntries: number
): FileTreeEntry[] {
  const directories = new Set<string>(directoryStubs);
  for (const filePath of filePaths) {
    const parts = filePath.split('/');
    for (let i = 1; i < parts.length; i++) {
      directories.add(parts.slice(0, i).join('/'));
    }
  }

  const entries: FileTreeEntry[] = [
    ...Array.from(directories).map((dir) => ({ path: dir, type: 'directory' as const })),
    ...filePaths.map((file) => ({ path: file, type: 'file' as const })),
  ];

  const uniqueByPath = new Map<string, FileTreeEntry>();
  for (const entry of entries) {
    uniqueByPath.set(entry.path, entry);
  }

  return Array.from(uniqueByPath.values())
    .sort((left, right) => {
      const depthDelta = entryDepth(left.path) - entryDepth(right.path);
      if (depthDelta !== 0) return depthDelta;
      return left.path.localeCompare(right.path);
    })
    .slice(0, maxEntries);
}
