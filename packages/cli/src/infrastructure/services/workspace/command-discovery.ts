/**
 * Command Discovery — scans workspace package.json and turbo.json for available commands.
 *
 * Discovers:
 * - package.json "scripts" entries
 * - turbo.json "tasks" entries (prefixed with "turbo run")
 *
 * Returns a flat list of commands with name, script, and source.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DiscoveredCommand {
  name: string;
  script: string;
  source: 'package.json' | 'turbo.json';
}

// ─── Discovery ──────────────────────────────────────────────────────────────

/**
 * Discover available commands from a workspace directory.
 * Reads package.json scripts and turbo.json tasks.
 */
export async function discoverCommands(workingDir: string): Promise<DiscoveredCommand[]> {
  const commands: DiscoveredCommand[] = [];

  // 1. Parse package.json scripts
  try {
    const pkgPath = join(workingDir, 'package.json');
    const pkgContent = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgContent) as { scripts?: Record<string, string> };

    if (pkg.scripts && typeof pkg.scripts === 'object') {
      for (const [name, script] of Object.entries(pkg.scripts)) {
        if (typeof script === 'string') {
          commands.push({
            name: `npm: ${name}`,
            script,
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
        commands.push({
          name: `turbo: ${taskName}`,
          script: `turbo run ${taskName}`,
          source: 'turbo.json',
        });
      }
    }
  } catch {
    // turbo.json doesn't exist or is invalid — skip
  }

  return commands;
}
