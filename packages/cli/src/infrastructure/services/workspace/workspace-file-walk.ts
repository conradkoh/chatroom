import { promises as fsPromises, type Dirent } from 'node:fs';
import path from 'node:path';
// fallow-ignore-file complexity

import {
  isPathIgnoredByRuleSets,
  loadDirectoryIgnoreRuleSets,
  type WorkspaceIgnoreRuleSet,
} from './workspace-ignore.js';
import { isAlwaysExcludedDirName, isPathVisible } from './workspace-visibility-policy.js';

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

  async function visitDir(
    relDir: string,
    inheritedRuleSets: readonly WorkspaceIgnoreRuleSet[]
  ): Promise<void> {
    if (truncated || filePaths.length >= maxFilePaths) {
      truncated = true;
      return;
    }

    const localRuleSets = await loadDirectoryIgnoreRuleSets(rootDir, relDir);
    const ruleSets =
      localRuleSets.length === 0 ? inheritedRuleSets : [...inheritedRuleSets, ...localRuleSets];
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
        if (isPathIgnoredByRuleSets(ruleSets, relativePath)) continue;
        await visitDir(relativePath, ruleSets);
      } else if (ent.isFile()) {
        if (isPathIgnoredByRuleSets(ruleSets, relativePath)) continue;
        filePaths.push(relativePath);
        if (filePaths.length >= maxFilePaths) truncated = true;
      }
    }
  }

  await visitDir('', []);
  return { filePaths, truncated };
}
