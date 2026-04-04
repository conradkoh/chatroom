/**
 * Command Discovery — scans workspace package.json and turbo.json for available commands.
 *
 * Discovers:
 * - package.json "scripts" entries (run via detected package manager)
 * - turbo.json "tasks" entries (run via detected package manager's turbo)
 *
 * Detects the package manager from lockfiles:
 * - pnpm-lock.yaml → pnpm
 * - yarn.lock → yarn
 * - bun.lockb / bun.lock → bun
 * - package-lock.json → npm (default fallback)
 *
 * Returns a flat list of commands with name, script, and source.
 */

import { access } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DiscoveredCommand {
  name: string;
  script: string;
  source: 'package.json' | 'turbo.json';
}

export type PackageManager = 'pnpm' | 'yarn' | 'bun' | 'npm';

/** Max length for command name and script to prevent abuse. */
const MAX_NAME_LENGTH = 256;
const MAX_SCRIPT_LENGTH = 4096;

// ─── Package Manager Detection ─────────────────────────────────────────────

/**
 * Lockfile names in priority order.
 * First match wins — pnpm > yarn > bun > npm.
 */
const LOCKFILE_MAP: Array<{ file: string; manager: PackageManager }> = [
  { file: 'pnpm-lock.yaml', manager: 'pnpm' },
  { file: 'yarn.lock', manager: 'yarn' },
  { file: 'bun.lockb', manager: 'bun' },
  { file: 'bun.lock', manager: 'bun' },
  { file: 'package-lock.json', manager: 'npm' },
];

/**
 * Detect the package manager for a workspace by checking for lockfiles.
 * Returns 'npm' as the default if no lockfile is found.
 */
export async function detectPackageManager(workingDir: string): Promise<PackageManager> {
  for (const { file, manager } of LOCKFILE_MAP) {
    try {
      await access(join(workingDir, file));
      return manager;
    } catch {
      // File doesn't exist — try next
    }
  }
  return 'npm'; // Default fallback
}

/**
 * Get the command prefix for running package.json scripts.
 * e.g. "pnpm run", "yarn run", "bun run", "npm run"
 */
function getScriptRunPrefix(pm: PackageManager): string {
  return `${pm} run`;
}

/**
 * Get the command prefix for running turbo tasks.
 * Uses the package manager to invoke turbo (avoids requiring global install).
 * e.g. "pnpm turbo run", "npx turbo run", "yarn turbo run", "bun turbo run"
 */
function getTurboRunPrefix(pm: PackageManager): string {
  switch (pm) {
    case 'pnpm':
      return 'pnpm turbo run';
    case 'yarn':
      return 'yarn turbo run';
    case 'bun':
      return 'bun turbo run';
    case 'npm':
    default:
      return 'npx turbo run';
  }
}

// ─── Discovery ──────────────────────────────────────────────────────────────

/**
 * Discover available commands from a workspace directory.
 * Reads package.json scripts and turbo.json tasks.
 * Detects the package manager from lockfiles to use the correct runner.
 */
export async function discoverCommands(workingDir: string): Promise<DiscoveredCommand[]> {
  const commands: DiscoveredCommand[] = [];
  const pm = await detectPackageManager(workingDir);
  const scriptPrefix = getScriptRunPrefix(pm);
  const turboPrefix = getTurboRunPrefix(pm);

  // 1. Parse package.json scripts
  try {
    const pkgPath = join(workingDir, 'package.json');
    const pkgContent = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgContent) as { scripts?: Record<string, string> };

    if (pkg.scripts && typeof pkg.scripts === 'object') {
      for (const [name, script] of Object.entries(pkg.scripts)) {
        if (typeof script === 'string' && name.length <= MAX_NAME_LENGTH && script.length <= MAX_SCRIPT_LENGTH) {
          commands.push({
            name: `${pm}: ${name}`,
            script: `${scriptPrefix} ${name}`,
            source: 'package.json',
          });
        }
      }
    }
  } catch {
    // package.json doesn't exist or is invalid — skip
  }

  // 2. Parse turbo.json tasks
  try {
    const turboPath = join(workingDir, 'turbo.json');
    const turboContent = await readFile(turboPath, 'utf-8');
    const turbo = JSON.parse(turboContent) as { tasks?: Record<string, unknown> };

    if (turbo.tasks && typeof turbo.tasks === 'object') {
      for (const taskName of Object.keys(turbo.tasks)) {
        if (taskName.length <= MAX_NAME_LENGTH) {
          commands.push({
            name: `turbo: ${taskName}`,
            script: `${turboPrefix} ${taskName}`,
            source: 'turbo.json',
          });
        }
      }
    }
  } catch {
    // turbo.json doesn't exist or is invalid — skip
  }

  return commands;
}
