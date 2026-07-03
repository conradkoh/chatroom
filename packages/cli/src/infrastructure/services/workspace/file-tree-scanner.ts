/**
 * File tree scanner for workspace directories.
 *
 * NOTE: "workspace" here refers to a chatroom workspace (the workingDir / project root),
 * not a package manager sub-workspace (e.g., monorepo packages). For sub-workspace
 * resolution, see workspace-resolver.ts.
 *
 * Uses git for fast candidate enumeration with .gitignore pruning.
 * Filesystem access() is the final arbiter for what exists on disk.
 * Produces a flat array of FileTreeEntry objects.
 */

import { exec } from 'node:child_process';
import { promises as fsPromises, type Dirent } from 'node:fs';
import path from 'node:path';
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

/** Per-subtree size cap when falling back to FS walk (non-git folders). */
const FS_FALLBACK_MAX_SUBTREE_BYTES = 50 * 1024 * 1024; // 50 MB

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

/** Patterns to exclude at the file level (any path component matching these globs). */
const EXCLUDE_PATTERNS = [
  /node_modules/i,
  /\.git/i,
  /dist/i,
  /build/i,
  /\.next/i,
  /coverage/i,
  /__pycache__/i,
  /\.turbo/i,
  /\.cache/i,
  /\.tmp/i,
  /tmp/i,
  /\.DS_Store/i,
];

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
export async function scanFileTree(rootDir: string, options?: ScanOptions): Promise<FileTree> {
  const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const scannedAt = Date.now();

  const filePaths = (await isGitRepo(rootDir))
    ? await getGitFiles(rootDir)
    : await walkFsFallback(rootDir, maxEntries, FS_FALLBACK_MAX_SUBTREE_BYTES);

  // Filter out always-excluded directories and patterns
  const filteredPaths = filePaths.filter((p) => !isExcluded(p) && !matchesExcludePattern(p));

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
 * Check if a directory is a git repository.
 */
// fallow-ignore-next-line unused-export
export async function isGitRepo(rootDir: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync('git rev-parse --is-inside-work-tree', {
      cwd: rootDir,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', NO_COLOR: '1' },
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Walks `rootDir` depth-first as a fallback when git is unavailable.
 * Skips any subtree whose accumulated file size exceeds `maxSubtreeBytes`
 * (that subtree contributes nothing; siblings still scanned).
 * Honors ALWAYS_EXCLUDE on directory names.
 * Stops collecting once `maxEntries` files are gathered.
 */
// fallow-ignore-next-line unused-export
export async function walkFsFallback(
  rootDir: string,
  maxEntries: number,
  maxSubtreeBytes: number
): Promise<string[]> {
  const collected: string[] = [];
  await walkSubtree(rootDir, '', collected, maxEntries, maxSubtreeBytes);
  return collected;
}

/**
 * Returns the size contributed by this subtree if kept, or `null` if the
 * subtree was skipped due to size. Mutates `collected` only for kept files.
 */
// fallow-ignore-next-line complexity
async function walkSubtree(
  absRoot: string,
  relDir: string,
  collected: string[],
  maxEntries: number,
  maxSubtreeBytes: number
): Promise<number | null> {
  if (collected.length >= maxEntries) return 0;

  const absDir = relDir ? path.join(absRoot, relDir) : absRoot;
  let dirents: Dirent[];
  try {
    dirents = await fsPromises.readdir(absDir, { withFileTypes: true });
  } catch {
    return 0;
  }

  // Stage this subtree's files separately so we can discard them
  // wholesale if the subtree exceeds the size cap.
  const staged: string[] = [];
  let subtreeBytes = 0;

  for (const ent of dirents) {
    if (collected.length + staged.length >= maxEntries) break;
    if (ALWAYS_EXCLUDE.has(ent.name)) continue;

    const childRel = relDir ? `${relDir}/${ent.name}` : ent.name;

    if (ent.isDirectory()) {
      // Recurse into a temp buffer so we can decide to keep or skip
      const subCollected: string[] = [];
      const subSize = await walkSubtree(
        absRoot,
        childRel,
        subCollected,
        maxEntries - collected.length - staged.length,
        maxSubtreeBytes
      );
      if (subSize === null) {
        // Sub-subtree was skipped (too large) — propagate skip ONLY for that branch
        continue;
      }
      subtreeBytes += subSize;
      if (subtreeBytes > maxSubtreeBytes) {
        // This whole subtree busts the cap — discard staged AND already-accepted children
        return null;
      }
      staged.push(...subCollected);
    } else if (ent.isFile()) {
      try {
        const st = await fsPromises.stat(path.join(absRoot, childRel));
        subtreeBytes += st.size;
        if (subtreeBytes > maxSubtreeBytes) {
          return null;
        }
        staged.push(childRel);
      } catch {
        // Unreadable file — ignore
      }
    }
    // Skip symlinks and other special entries silently
  }

  // Subtree survived — commit staged paths
  for (const p of staged) {
    if (collected.length >= maxEntries) break;
    collected.push(p);
  }
  return subtreeBytes;
}

/**
 * Gets all files using git ls-files (tracked + untracked).
 * Returns relative paths from rootDir that exist on disk.
 */
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
    const candidates = [...new Set([...trackedFiles, ...untrackedFiles])];

    return filterToExistingPaths(rootDir, candidates);
  } catch {
    // Not a git repo or git not available — return empty
    return [];
  }
}

/**
 * Filter candidate paths to those that exist on disk.
 * Filesystem is the source of truth for existence; git only provides candidates.
 */
// fallow-ignore-next-line unused-export
export async function filterToExistingPaths(
  rootDir: string,
  filePaths: string[]
): Promise<string[]> {
  const checks = await Promise.all(
    filePaths.map(async (filePath) => {
      try {
        await fsPromises.access(path.join(rootDir, filePath));
        return filePath;
      } catch {
        return null;
      }
    })
  );
  return checks.filter((p): p is string => p !== null);
}

/** Parse newline-separated output into non-empty lines. */
function parseLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Check if a path contains an always-excluded directory segment. */
// fallow-ignore-next-line unused-export
export function isExcluded(filePath: string): boolean {
  const segments = filePath.split('/');
  return segments.some((segment) => ALWAYS_EXCLUDE.has(segment));
}

/** Check if a path matches any exclude pattern (case-insensitive). */
// fallow-ignore-next-line unused-export
export function matchesExcludePattern(filePath: string): boolean {
  return EXCLUDE_PATTERNS.some((pattern) => pattern.test(filePath));
}

/**
 * Build FileTreeEntry array from file paths.
 * Derives directory entries from the file paths.
 * Caps at maxEntries total (files + directories).
 */
// fallow-ignore-next-line unused-export
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
