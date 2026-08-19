// fallow-ignore-file complexity
import { promises as fsPromises, type Dirent } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import ignore, { type Ignore } from 'ignore';

import { classifyDirectorySyncMode, isPathVisible } from './workspace-visibility-policy.js';

const IGNORE_FILES = ['.gitignore', '.cursorignore'] as const;

export interface WorkspaceIgnoreRuleSet {
  /** Directory containing the ignore file, relative to the workspace root. */
  baseDir: string;
  matcher: Ignore;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\/+$/, '');
}

function expandUserPath(filePath: string): string {
  if (filePath === '~') return homedir();
  if (filePath.startsWith('~/')) return path.join(homedir(), filePath.slice(2));
  return filePath;
}

// fallow-ignore-next-line unused-export
export function readExcludesFileFromGitconfig(content: string): string | null {
  let inCore = false;
  for (const line of content.split(/\r?\n/)) {
    const section = line.match(/^\s*\[([^\]]+)\]/);
    if (section) {
      inCore = section[1].trim().toLowerCase() === 'core';
      continue;
    }
    if (!inCore) continue;
    const match = line.match(/^\s*excludesfile\s*=\s*(.*?)\s*(?:[#;].*)?$/i);
    if (!match) continue;
    const value = match[1].trim().replace(/^(["'])(.*)\1$/, '$2');
    return value ? expandUserPath(value) : null;
  }
  return null;
}

async function readGitconfigExcludesFilePath(configPath: string): Promise<string | null> {
  const content = await readIgnoreFile(configPath);
  if (content === null) return null;
  const raw = readExcludesFileFromGitconfig(content);
  if (!raw) return null;
  return path.isAbsolute(raw) ? expandUserPath(raw) : path.resolve(path.dirname(configPath), raw);
}

// fallow-ignore-next-line unused-export
export async function resolveGitExtraExcludeFilePaths(rootDir: string): Promise<string[]> {
  const globalConfig = process.env.GIT_CONFIG_GLOBAL?.length
    ? process.env.GIT_CONFIG_GLOBAL
    : path.join(homedir(), '.gitconfig');
  const localConfig = path.join(rootDir, '.git', 'config');
  let excludesFile =
    (await readGitconfigExcludesFilePath(localConfig)) ??
    (await readGitconfigExcludesFilePath(globalConfig));
  if (!excludesFile) {
    excludesFile = path.join(
      process.env.XDG_CONFIG_HOME?.length
        ? process.env.XDG_CONFIG_HOME
        : path.join(homedir(), '.config'),
      'git',
      'ignore'
    );
  }
  const candidates = [excludesFile, path.join(rootDir, '.git', 'info', 'exclude')];
  const existing: string[] = [];
  for (const candidate of candidates)
    if ((await readIgnoreFile(candidate)) !== null) existing.push(candidate);
  return existing;
}

async function loadGitExtraExcludeRuleSets(rootDir: string): Promise<WorkspaceIgnoreRuleSet[]> {
  const result: WorkspaceIgnoreRuleSet[] = [];
  for (const filePath of await resolveGitExtraExcludeFilePaths(rootDir)) {
    const content = await readIgnoreFile(filePath);
    if (content !== null) result.push({ baseDir: '', matcher: ignore().add(content) });
  }
  return result;
}

async function readIgnoreFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/** Load git extra excludes and workspace root ignore files. Missing files are skipped. */
// fallow-ignore-next-line unused-export
export async function loadWorkspaceIgnore(rootDir: string): Promise<Ignore> {
  const ig = ignore();
  for (const filePath of await resolveGitExtraExcludeFilePaths(rootDir)) {
    const content = await readIgnoreFile(filePath);
    if (content !== null) ig.add(content);
  }
  for (const name of IGNORE_FILES) {
    const content = await readIgnoreFile(path.join(rootDir, name));
    if (content !== null) ig.add(content);
  }
  return ig;
}

/** Returns true if `relativePath` (forward-slash, repo-relative) is ignored. */
// fallow-ignore-next-line unused-export
export function isPathIgnoredByRules(ig: Ignore, relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath);
  return ig.ignores(normalized);
}

/**
 * Load ignore rules declared in one workspace directory.
 *
 * Nested directories contribute their own `.gitignore`. `.cursorignore` is
 * intentionally workspace-root-only, matching Cursor's workspace semantics.
 */
export async function loadDirectoryIgnoreRuleSets(
  rootDir: string,
  relativeDir: string
): Promise<WorkspaceIgnoreRuleSet[]> {
  const normalizedDir = normalizeRelativePath(relativeDir);
  const absoluteDir = normalizedDir ? path.join(rootDir, normalizedDir) : rootDir;
  const names = normalizedDir ? (['.gitignore'] as const) : IGNORE_FILES;
  const result: WorkspaceIgnoreRuleSet[] = normalizedDir
    ? []
    : await loadGitExtraExcludeRuleSets(rootDir);

  for (const name of names) {
    const content = await readIgnoreFile(path.join(absoluteDir, name));
    if (content === null) continue;
    result.push({ baseDir: normalizedDir, matcher: ignore().add(content) });
  }
  return result;
}

/**
 * Evaluate root and nested ignore files in declaration order.
 * A nested negation can re-include a path ignored by an earlier applicable
 * rule set, while an ignored parent directory remains pruned by the walker.
 */
export function isPathIgnoredByRuleSets(
  ruleSets: readonly WorkspaceIgnoreRuleSet[],
  relativePath: string
): boolean {
  const normalized = normalizeRelativePath(relativePath);
  let ignored = false;

  for (const ruleSet of ruleSets) {
    if (
      ruleSet.baseDir &&
      normalized !== ruleSet.baseDir &&
      !normalized.startsWith(`${ruleSet.baseDir}/`)
    ) {
      continue;
    }
    const localPath = ruleSet.baseDir
      ? normalized.slice(ruleSet.baseDir.length).replace(/^\/+/, '')
      : normalized;
    if (!localPath) continue;
    const result = ruleSet.matcher.test(localPath);
    if (result.ignored) ignored = true;
    else if (result.unignored) ignored = false;
  }

  return ignored;
}

/** Load only the rule files that can affect one path. */
async function loadApplicableIgnoreRuleSets(
  rootDir: string,
  relativePath: string
): Promise<WorkspaceIgnoreRuleSet[]> {
  const normalized = normalizeRelativePath(relativePath);
  const parentParts = normalized.split('/').slice(0, -1);
  const ruleSets: WorkspaceIgnoreRuleSet[] = [];

  ruleSets.push(...(await loadDirectoryIgnoreRuleSets(rootDir, '')));
  let currentDir = '';
  for (const part of parentParts) {
    currentDir = currentDir ? `${currentDir}/${part}` : part;
    ruleSets.push(...(await loadDirectoryIgnoreRuleSets(rootDir, currentDir)));
  }
  return ruleSets;
}

export async function isWorkspacePathIgnored(
  rootDir: string,
  relativePath: string
): Promise<boolean> {
  const ruleSets = await loadApplicableIgnoreRuleSets(rootDir, relativePath);
  return isPathIgnoredByRuleSets(ruleSets, relativePath);
}

export function mergeWorkspaceIgnoreRuleSets(
  inheritedRuleSets: readonly WorkspaceIgnoreRuleSet[],
  localRuleSets: readonly WorkspaceIgnoreRuleSet[]
): WorkspaceIgnoreRuleSet[] {
  return localRuleSets.length === 0
    ? [...inheritedRuleSets]
    : [...inheritedRuleSets, ...localRuleSets];
}

export async function readWorkspaceDirectoryDirents(
  rootDir: string,
  relDir: string
): Promise<Dirent[] | null> {
  const absDir = relDir ? path.join(rootDir, relDir) : rootDir;
  try {
    return await fsPromises.readdir(absDir, { withFileTypes: true });
  } catch {
    return null;
  }
}

/**
 * Walk the workspace once and collect every applicable ignore rule set.
 * Prunes ignored directories, including git extra excludes, so ignored trees are not traversed.
 * Used to align chokidar watch scope with filesystem scan semantics.
 */
export async function loadAllWorkspaceIgnoreRuleSets(
  rootDir: string
): Promise<WorkspaceIgnoreRuleSet[]> {
  const collected: WorkspaceIgnoreRuleSet[] = [];

  async function visit(
    relDir: string,
    inheritedRuleSets: readonly WorkspaceIgnoreRuleSet[]
  ): Promise<void> {
    const localRuleSets = await loadDirectoryIgnoreRuleSets(rootDir, relDir);
    const ruleSets = mergeWorkspaceIgnoreRuleSets(inheritedRuleSets, localRuleSets);
    collected.push(...localRuleSets);

    const dirents = await readWorkspaceDirectoryDirents(rootDir, relDir);
    if (!dirents) return;

    for (const ent of dirents) {
      if (!ent.isDirectory()) continue;

      const relativePath = relDir ? `${relDir}/${ent.name}` : ent.name;
      if (!isPathVisible(relativePath)) continue;
      if (isPathIgnoredByRuleSets(ruleSets, relativePath)) continue;

      const syncMode = classifyDirectorySyncMode(ent.name, {
        relativePath,
        immediateSiblingCount: dirents.length,
        immediateChildCount: 0,
      });
      if (syncMode !== 'full') continue;

      await visit(relativePath, ruleSets);
    }
  }

  await visit('', []);
  return collected;
}
