/**
 * Workspace Resolver — discovers workspace packages in a monorepo.
 *
 * Supports:
 * - pnpm: reads `pnpm-workspace.yaml`
 * - yarn/npm/bun: reads `package.json` → `workspaces` field
 *
 * Resolves glob patterns (e.g., `apps/*`) to actual directories,
 * then reads each sub-package's `package.json` for name and scripts.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, basename, resolve } from 'node:path';

import type { PackageManager } from './command-discovery.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SubWorkspacePackage {
  /** Package name from package.json (e.g., "@workspace/webapp") */
  name: string;
  /** Absolute path to the package directory */
  dir: string;
  /** Scripts from the package's package.json */
  scripts: Record<string, string>;
}

/** @deprecated Use SubWorkspacePackage instead */
export type WorkspacePackage = SubWorkspacePackage;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Resolve a single glob pattern to matching directories.
 * Only supports trailing `/*` patterns (e.g., `apps/*`, `packages/*`).
 * Literal paths (e.g., `tools/my-tool`) are also supported.
 */
async function resolveGlobPattern(rootDir: string, pattern: string): Promise<string[]> {
  // Strip trailing slash if present
  const cleaned = pattern.replace(/\/+$/, '');

  // Security: reject patterns with path traversal
  if (cleaned.includes('..')) {
    return [];
  }

  if (cleaned.endsWith('/*')) {
    // Glob pattern: list subdirectories
    const parentDir = join(rootDir, cleaned.slice(0, -2));
    try {
      const entries = await readdir(parentDir, { withFileTypes: true });
      const dirs: string[] = [];
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dirPath = join(parentDir, entry.name);
          // Security: ensure resolved path stays within root
          if (resolve(dirPath).startsWith(resolve(rootDir))) {
            dirs.push(dirPath);
          }
        }
      }
      return dirs;
    } catch {
      return []; // Parent directory doesn't exist
    }
  } else {
    // Literal path
    const dir = join(rootDir, cleaned);
    try {
      // Security: ensure resolved path stays within root
      if (!resolve(dir).startsWith(resolve(rootDir))) return [];
      const s = await stat(dir);
      if (s.isDirectory()) return [dir];
    } catch {
      // Directory doesn't exist
    }
    return [];
  }
}

/**
 * Read package.json from a directory.
 * Returns null if not found or invalid.
 */
async function readPackageJson(
  dir: string
): Promise<{ name: string; scripts: Record<string, string> } | null> {
  try {
    const content = await readFile(join(dir, 'package.json'), 'utf-8');
    const pkg = JSON.parse(content) as {
      name?: string;
      scripts?: Record<string, string>;
    };
    return {
      name: pkg.name || basename(dir),
      scripts: pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {},
    };
  } catch {
    return null;
  }
}

// ─── Workspace Config Readers ───────────────────────────────────────────────

/**
 * Read workspace patterns from pnpm-workspace.yaml.
 */
async function readPnpmWorkspacePatterns(rootDir: string): Promise<string[]> {
  try {
    const content = await readFile(join(rootDir, 'pnpm-workspace.yaml'), 'utf-8');
    // Simple YAML parser for the common case: `packages:\n  - 'pattern'\n  - 'pattern'`
    const patterns: string[] = [];
    let inPackages = false;
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === 'packages:') {
        inPackages = true;
        continue;
      }
      if (inPackages) {
        if (trimmed.startsWith('- ')) {
          // Extract the pattern, removing quotes
          const pattern = trimmed.slice(2).replace(/['"]/g, '').trim();
          if (pattern) patterns.push(pattern);
        } else if (trimmed && !trimmed.startsWith('#')) {
          // Hit a new top-level key — stop
          break;
        }
      }
    }
    return patterns;
  } catch {
    return [];
  }
}

/**
 * Read workspace patterns from package.json workspaces field.
 * Supports both array format and `{ packages: [...] }` format.
 */
async function readPackageJsonWorkspacePatterns(rootDir: string): Promise<string[]> {
  try {
    const content = await readFile(join(rootDir, 'package.json'), 'utf-8');
    const pkg = JSON.parse(content) as {
      workspaces?: string[] | { packages: string[] };
    };
    if (!pkg.workspaces) return [];
    if (Array.isArray(pkg.workspaces)) return pkg.workspaces;
    if (pkg.workspaces.packages && Array.isArray(pkg.workspaces.packages)) {
      return pkg.workspaces.packages;
    }
    return [];
  } catch {
    return [];
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Resolve all workspace packages for a monorepo.
 *
 * @param rootDir - Root directory of the monorepo
 * @param pm - Detected package manager
 * @returns List of workspace packages with name, dir, and scripts
 */
export async function resolveSubWorkspaces(
  rootDir: string,
  pm: PackageManager
): Promise<SubWorkspacePackage[]> {
  // 1. Get workspace patterns
  let patterns: string[] = [];

  if (pm === 'pnpm') {
    // pnpm uses pnpm-workspace.yaml (primary) or falls back to package.json
    patterns = await readPnpmWorkspacePatterns(rootDir);
    if (patterns.length === 0) {
      patterns = await readPackageJsonWorkspacePatterns(rootDir);
    }
  } else {
    // yarn, npm, bun use package.json workspaces field
    patterns = await readPackageJsonWorkspacePatterns(rootDir);
  }

  if (patterns.length === 0) return [];

  // 2. Resolve patterns to directories
  const allDirs: string[] = [];
  for (const pattern of patterns) {
    const dirs = await resolveGlobPattern(rootDir, pattern);
    allDirs.push(...dirs);
  }

  // Deduplicate
  const uniqueDirs = [...new Set(allDirs)];

  // 3. Read package.json from each directory
  const packages: SubWorkspacePackage[] = [];
  for (const dir of uniqueDirs) {
    const pkg = await readPackageJson(dir);
    if (pkg) {
      packages.push({
        name: pkg.name,
        dir,
        scripts: pkg.scripts,
      });
    }
  }

  return packages;
}

/** @deprecated Use resolveSubWorkspaces instead */
export const resolveWorkspacePackages = resolveSubWorkspaces;
