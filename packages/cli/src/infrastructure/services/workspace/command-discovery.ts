/**
 * Command Discovery — scans workspace package.json and turbo.json for available commands.
 *
 * Discovers:
 * - Root package.json "scripts" entries (run via detected package manager)
 * - Root turbo.json "tasks" entries (run via detected package manager's turbo)
 * - Monorepo sub-package scripts (run via --filter / workspace syntax)
 * - Per-package turbo task variants (run via --filter)
 *
 * Detects the package manager from lockfiles:
 * - pnpm-lock.yaml → pnpm
 * - yarn.lock → yarn
 * - bun.lockb / bun.lock → bun
 * - package-lock.json → npm (default fallback)
 *
 * Returns a flat list of commands with name, script, and source.
 */

import { access, readFile } from 'node:fs/promises';
import { join, relative, basename } from 'node:path';

import { parseJsonc } from './jsonc.js';
import { resolveSubWorkspaces } from './workspace-resolver.js';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Structured sub-workspace info for a discovered command */
export interface SubWorkspaceInfo {
  /** Ecosystem type (e.g., "npm", "cargo", "go") */
  type: string;
  /** Relative path from workspace root to the sub-package directory */
  path: string;
  /** Package name from package manager (e.g., "@workspace/webapp") */
  name: string;
}

export interface DiscoveredCommand {
  name: string;
  script: string;
  source: 'package.json' | 'turbo.json' | 'deno.json';
  /** Structured sub-workspace info. Refers to package manager workspace packages, not the chatroom workspace (workingDir). */
  subWorkspace: SubWorkspaceInfo;
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
const LOCKFILE_MAP: { file: string; manager: PackageManager }[] = [
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
async function detectPackageManager(workingDir: string): Promise<PackageManager> {
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

// ─── Command Prefix Helpers ─────────────────────────────────────────────────

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

/**
 * Get the command for running a script in a specific workspace package.
 * Uses the package manager's filter/workspace syntax.
 */
function getFilteredScriptCommand(
  pm: PackageManager,
  packageName: string,
  scriptName: string
): string {
  switch (pm) {
    case 'pnpm':
      return `pnpm --filter ${packageName} run ${scriptName}`;
    case 'yarn':
      return `yarn workspace ${packageName} run ${scriptName}`;
    case 'bun':
      return `bun --filter ${packageName} run ${scriptName}`;
    case 'npm':
    default:
      return `npm --workspace=${packageName} run ${scriptName}`;
  }
}

/**
 * Get the command for running a turbo task filtered to a specific package.
 */
function getFilteredTurboCommand(
  pm: PackageManager,
  packageName: string,
  taskName: string
): string {
  const prefix = getTurboRunPrefix(pm);
  return `${prefix} ${taskName} --filter=${packageName}`;
}

// ─── Discovery ──────────────────────────────────────────────────────────────

/**
 * Discover available commands from a workspace directory.
 * Reads package.json scripts and turbo.json tasks from root and all sub-packages.
 * Detects the package manager from lockfiles to use the correct runner.
 */
function isValidScriptEntry(name: string, script: string | unknown): script is string {
  return (
    typeof script === 'string' &&
    name.length <= MAX_NAME_LENGTH &&
    script.length <= MAX_SCRIPT_LENGTH
  );
}

async function readJsonFile<T>(filePath: string, label: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return parseJsonc<T>(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.debug(`[command-discovery] skipping ${label}: ${(error as Error).message}`);
    }
    return null;
  }
}

function collectRootScriptCommands(
  scripts: Record<string, string>,
  pm: PackageManager,
  scriptPrefix: string,
  rootSw: SubWorkspaceInfo
): DiscoveredCommand[] {
  const commands: DiscoveredCommand[] = [];
  for (const [name, script] of Object.entries(scripts)) {
    if (!isValidScriptEntry(name, script)) continue;
    commands.push({
      name: `${pm}: ${name}`,
      script: `${scriptPrefix} ${name}`,
      source: 'package.json',
      subWorkspace: rootSw,
    });
  }
  return commands;
}

async function readRootPackageJson(
  workingDir: string,
  pm: PackageManager,
  scriptPrefix: string
): Promise<{ commands: DiscoveredCommand[]; rootPackageName: string }> {
  let rootPackageName = basename(workingDir);

  const pkg = await readJsonFile<{ name?: string; scripts?: Record<string, string> }>(
    join(workingDir, 'package.json'),
    'root package.json'
  );
  if (!pkg) return { commands: [], rootPackageName };

  if (pkg.name) rootPackageName = pkg.name;

  const scripts = pkg.scripts;
  if (!scripts || typeof scripts !== 'object') return { commands: [], rootPackageName };

  const rootSw: SubWorkspaceInfo = { type: 'npm', path: '.', name: rootPackageName };
  return {
    commands: collectRootScriptCommands(scripts, pm, scriptPrefix, rootSw),
    rootPackageName,
  };
}

async function readTurboJson(
  workingDir: string,
  _turboPrefix: string,
  _rootSubWorkspace: SubWorkspaceInfo
): Promise<string[]> {
  const turboTaskNames: string[] = [];
  const turbo = await readJsonFile<{ tasks?: Record<string, unknown> }>(
    join(workingDir, 'turbo.json'),
    'turbo.json'
  );
  if (!turbo?.tasks || typeof turbo.tasks !== 'object') return turboTaskNames;

  for (const taskName of Object.keys(turbo.tasks)) {
    if (taskName.length <= MAX_NAME_LENGTH) {
      turboTaskNames.push(taskName);
    }
  }
  return turboTaskNames;
}

async function readDenoJson(workingDir: string): Promise<DiscoveredCommand[]> {
  const commands: DiscoveredCommand[] = [];
  for (const fileName of ['deno.json', 'deno.jsonc'] as const) {
    const deno = await readJsonFile<{ name?: string; tasks?: Record<string, string> }>(
      join(workingDir, fileName),
      fileName
    );
    if (!deno?.tasks || typeof deno.tasks !== 'object') continue;

    const pkgName = deno.name ?? basename(workingDir);
    const subWorkspace: SubWorkspaceInfo = { type: 'deno', path: '.', name: pkgName };

    for (const [taskName, taskCommand] of Object.entries(deno.tasks)) {
      if (!isValidScriptEntry(taskName, taskCommand)) continue;
      commands.push({
        name: `deno: ${taskName}`,
        script: `deno task ${taskName}`,
        source: 'deno.json',
        subWorkspace,
      });
    }
    break; // prefer deno.json over deno.jsonc if both exist
  }
  return commands;
}

export async function discoverCommands(workingDir: string): Promise<DiscoveredCommand[]> {
  const commands: DiscoveredCommand[] = [];
  const pm = await detectPackageManager(workingDir);
  const scriptPrefix = getScriptRunPrefix(pm);
  const turboPrefix = getTurboRunPrefix(pm);

  const { commands: rootCommands, rootPackageName } = await readRootPackageJson(
    workingDir,
    pm,
    scriptPrefix
  );
  commands.push(...rootCommands);

  const denoCommands = await readDenoJson(workingDir);
  commands.push(...denoCommands);

  const rootSubWorkspace: SubWorkspaceInfo = { type: 'npm', path: '.', name: rootPackageName };
  const turboTaskNames = await readTurboJson(workingDir, turboPrefix, rootSubWorkspace);

  for (const taskName of turboTaskNames) {
    commands.push({
      name: `turbo: ${taskName}`,
      script: `${turboPrefix} ${taskName}`,
      source: 'turbo.json',
      subWorkspace: rootSubWorkspace,
    });
  }

  const subWorkspaces = await resolveSubWorkspaces(workingDir, pm);

  for (const pkg of subWorkspaces) {
    const wsPath = relative(workingDir, pkg.dir) || '.';
    const pkgSubWorkspace: SubWorkspaceInfo = { type: 'npm', path: wsPath, name: pkg.name };
    await addSubWorkspaceCommands(commands, pm, pkg, wsPath, pkgSubWorkspace, turboTaskNames);
  }

  return commands;
}

async function addSubWorkspaceCommands(
  commands: DiscoveredCommand[],
  pm: PackageManager,
  pkg: { dir: string; name: string; scripts: Record<string, string> },
  wsPath: string,
  pkgSubWorkspace: SubWorkspaceInfo,
  turboTaskNames: string[]
): Promise<void> {
  for (const taskName of turboTaskNames) {
    commands.push({
      name: `turbo: ${taskName} (${pkg.name})`,
      script: getFilteredTurboCommand(pm, pkg.name, taskName),
      source: 'turbo.json',
      subWorkspace: pkgSubWorkspace,
    });
  }

  for (const [scriptName, scriptValue] of Object.entries(pkg.scripts)) {
    if (
      typeof scriptValue === 'string' &&
      scriptName.length <= MAX_NAME_LENGTH &&
      scriptValue.length <= MAX_SCRIPT_LENGTH
    ) {
      commands.push({
        name: `${pkg.name}: ${scriptName}`,
        script: getFilteredScriptCommand(pm, pkg.name, scriptName),
        source: 'package.json',
        subWorkspace: pkgSubWorkspace,
      });
    }
  }
}
