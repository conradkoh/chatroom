import { promises as fsPromises, type Dirent } from 'node:fs';
import path from 'node:path';
// fallow-ignore-file complexity

import type { Ignore } from 'ignore';

import { isPathIgnoredByRules, loadWorkspaceIgnore } from './workspace-ignore.js';
import {
  filterIgnoredPaths,
  isAlwaysExcludedDirName,
  isPathVisible,
} from './workspace-visibility-policy.js';
import { isGitRepo } from '../../git/git-reader.js';

export type WalkWorkspaceFilesOptions = {
  maxFilePaths?: number;
};

export type WalkWorkspaceFilesResult = {
  filePaths: string[];
  truncated: boolean;
};

/**
 * Walk workspace filesystem and collect file paths (repo-relative, forward-slash).
 * Prunes excluded/ignored directories early. Respects maxFilePaths cap.
 */
// fallow-ignore-next-line complexity
export async function walkWorkspaceFiles(
  rootDir: string,
  options?: WalkWorkspaceFilesOptions
): Promise<WalkWorkspaceFilesResult> {
  const maxFilePaths = options?.maxFilePaths ?? 10_000;
  const filePaths: string[] = [];
  let truncated = false;

  const inRepo = await isGitRepo(rootDir);
  const parsedIgnore: Ignore | null = inRepo ? null : await loadWorkspaceIgnore(rootDir);

  async function isIgnored(relativePath: string): Promise<boolean> {
    if (inRepo) {
      const ignored = await filterIgnoredPaths(rootDir, [relativePath]);
      return ignored.has(relativePath);
    }
    return parsedIgnore !== null && isPathIgnoredByRules(parsedIgnore, relativePath);
  }

  async function visitDir(relDir: string): Promise<void> {
    if (truncated || filePaths.length >= maxFilePaths) {
      truncated = true;
      return;
    }

    const absDir = relDir ? path.join(rootDir, relDir) : rootDir;
    let dirents: Dirent[];
    try {
      dirents = await fsPromises.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const ent of dirents) {
      if (truncated || filePaths.length >= maxFilePaths) {
        truncated = true;
        return;
      }

      if (isAlwaysExcludedDirName(ent.name)) continue;

      const relativePath = relDir ? `${relDir}/${ent.name}` : ent.name;
      if (!isPathVisible(relativePath)) continue;

      if (ent.isDirectory()) {
        if (await isIgnored(relativePath)) continue;
        await visitDir(relativePath);
      } else if (ent.isFile()) {
        if (await isIgnored(relativePath)) continue;
        filePaths.push(relativePath);
        if (filePaths.length >= maxFilePaths) truncated = true;
      }
    }
  }

  await visitDir('');
  return { filePaths, truncated };
}
