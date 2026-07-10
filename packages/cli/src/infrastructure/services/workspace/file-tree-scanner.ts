/**
 * File tree scanner for workspace directories.
 *
 * Uses `git ls-files` in git repos; falls back to filesystem walk otherwise.
 * Produces a flat array of FileTreeEntry objects.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import type {
  FileTree,
  FileTreeEntry,
} from '@workspace/backend/src/domain/entities/workspace-files.js';

import { walkWorkspaceFiles } from './workspace-file-walk.js';
import { hasExcludedDirSegment } from './workspace-visibility-policy.js';
import { isGitRepo } from '../../git/git-reader.js';

const execAsync = promisify(exec);

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

  const inRepo = await isGitRepo(rootDir);
  let filePaths: string[];

  if (inRepo) {
    filePaths = await getGitFiles(rootDir);
  } else {
    const walk = await walkWorkspaceFiles(rootDir, { maxFilePaths: maxEntries });
    filePaths = walk.filePaths;
  }

  const filteredPaths = filePaths.filter((p) => !isExcluded(p));
  const entries = buildEntries(filteredPaths, maxEntries);

  return {
    entries,
    scannedAt,
    rootDir,
  };
}

async function getGitFiles(rootDir: string): Promise<string[]> {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat',
    NO_COLOR: '1',
  };

  try {
    const tracked = await execAsync('git ls-files', {
      cwd: rootDir,
      env,
      maxBuffer: 10 * 1024 * 1024,
    });

    const untracked = await execAsync('git ls-files --others --exclude-standard', {
      cwd: rootDir,
      env,
      maxBuffer: 10 * 1024 * 1024,
    });

    const trackedFiles = parseLines(tracked.stdout);
    const untrackedFiles = parseLines(untracked.stdout);
    const allFiles = new Set([...trackedFiles, ...untrackedFiles]);
    return Array.from(allFiles);
  } catch {
    return [];
  }
}

function parseLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
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
