/**
 * File tree scanner for workspace directories.
 *
 * NOTE: "workspace" here refers to a chatroom workspace (the workingDir / project root),
 * not a package manager sub-workspace (e.g., monorepo packages). For sub-workspace
 * resolution, see workspace-resolver.ts.
 *
 * Uses `git ls-files` for fast scanning that respects .gitignore.
 * Falls back to tracked + untracked files approach.
 * Produces a flat array of FileTreeEntry objects.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// ─── Types ──────────────────────────────────────────────────────────────────

export type FileTreeEntry = {
  path: string;
  type: 'file' | 'directory';
  size?: number;
};

export type FileTree = {
  entries: FileTreeEntry[];
  scannedAt: number;
  rootDir: string;
};

export type ScanOptions = {
  maxEntries?: number;
};

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_MAX_ENTRIES = 10_000;

/** Directories to always exclude (even outside git repos or if git misbehaves). */
const ALWAYS_EXCLUDE = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '__pycache__',
  '.turbo',
  // Additional common patterns that cause noise in file pickers
  '.cache',
  '.tmp',
  'tmp',
  '.DS_Store',
]);

// ─── Scanner ────────────────────────────────────────────────────────────────

/**
 * Scans the file tree of a workspace directory.
 *
 * Uses `git ls-files` for tracked files and
 * `git ls-files --others --exclude-standard` for untracked files.
 * This is fast and respects .gitignore natively.
 *
 * @param rootDir - Absolute path to the workspace root
 * @param options - Optional: maxEntries cap (default 10,000)
 * @returns FileTree with flat array of entries
 */
export async function scanFileTree(
  rootDir: string,
  options?: ScanOptions
): Promise<FileTree> {
  const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const scannedAt = Date.now();

  const filePaths = await getGitFiles(rootDir);

  // Filter out always-excluded directories
  const filteredPaths = filePaths.filter((p) => !isExcluded(p));

  // Derive directories from file paths and build entries
  const entries = buildEntries(filteredPaths, rootDir, maxEntries);

  return {
    entries,
    scannedAt,
    rootDir,
  };
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Gets all files using git ls-files (tracked + untracked).
 * Returns relative paths from rootDir.
 */
async function getGitFiles(rootDir: string): Promise<string[]> {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat',
    NO_COLOR: '1',
  };

  try {
    // Get tracked files
    const tracked = await execAsync('git ls-files', {
      cwd: rootDir,
      env,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large repos
    });

    // Get untracked files (respects .gitignore)
    const untracked = await execAsync(
      'git ls-files --others --exclude-standard',
      {
        cwd: rootDir,
        env,
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    const trackedFiles = parseLines(tracked.stdout);
    const untrackedFiles = parseLines(untracked.stdout);

    // Combine and deduplicate
    const allFiles = new Set([...trackedFiles, ...untrackedFiles]);
    return Array.from(allFiles);
  } catch {
    // Not a git repo or git not available — return empty
    return [];
  }
}

/** Parse newline-separated output into non-empty lines. */
function parseLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Check if a path contains an always-excluded directory segment. */
export function isExcluded(filePath: string): boolean {
  const segments = filePath.split('/');
  return segments.some((segment) => ALWAYS_EXCLUDE.has(segment));
}

/**
 * Build FileTreeEntry array from file paths.
 * Derives directory entries from the file paths.
 * Caps at maxEntries total (files + directories).
 */
export function buildEntries(
  filePaths: string[],
  rootDir: string,
  maxEntries: number
): FileTreeEntry[] {
  // Collect unique directories
  const directories = new Set<string>();
  for (const filePath of filePaths) {
    const parts = filePath.split('/');
    // Add all parent directories
    for (let i = 1; i < parts.length; i++) {
      directories.add(parts.slice(0, i).join('/'));
    }
  }

  // Build entries: directories first, then files
  const entries: FileTreeEntry[] = [];

  // Add directory entries
  const sortedDirs = Array.from(directories).sort();
  for (const dir of sortedDirs) {
    if (entries.length >= maxEntries) break;
    entries.push({ path: dir, type: 'directory' });
  }

  // Add file entries
  const sortedFiles = filePaths.slice().sort();
  for (const file of sortedFiles) {
    if (entries.length >= maxEntries) break;
    entries.push({ path: file, type: 'file' });
  }

  return entries;
}
