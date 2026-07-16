import {
  isPathIgnoredByRuleSets,
  loadDirectoryIgnoreRuleSets,
  mergeWorkspaceIgnoreRuleSets,
  readWorkspaceDirectoryDirents,
  type WorkspaceIgnoreRuleSet,
} from './workspace-ignore.js';
import { classifyDirectorySyncMode, isPathVisible } from './workspace-visibility-policy.js';

export type WalkWorkspaceFilesOptions = {
  maxFilePaths?: number;
};

export type WalkWorkspaceFilesResult = {
  filePaths: string[];
  /** Directory paths that should appear in the tree even when children are not synced. */
  directoryStubs: string[];
  truncated: boolean;
};

/**
 * Walk workspace filesystem and collect file paths (repo-relative, forward-slash).
 * Prunes hidden/ignored directories early. Heavy directories become shallow stubs.
 * Respects maxFilePaths cap.
 */
// fallow-ignore-next-line complexity
export async function walkWorkspaceFiles(
  rootDir: string,
  options?: WalkWorkspaceFilesOptions
): Promise<WalkWorkspaceFilesResult> {
  const maxFilePaths = options?.maxFilePaths ?? 10_000;
  const filePaths: string[] = [];
  const directoryStubs: string[] = [];
  let truncated = false;

  // fallow-ignore-next-line complexity
  async function visitDir(
    relDir: string,
    inheritedRuleSets: readonly WorkspaceIgnoreRuleSet[],
    siblingCount: number
  ): Promise<void> {
    if (truncated || filePaths.length >= maxFilePaths) {
      truncated = true;
      return;
    }

    const localRuleSets = await loadDirectoryIgnoreRuleSets(rootDir, relDir);
    const ruleSets = mergeWorkspaceIgnoreRuleSets(inheritedRuleSets, localRuleSets);
    const dirents = await readWorkspaceDirectoryDirents(rootDir, relDir);
    if (!dirents) return;

    for (const ent of dirents) {
      if (truncated || filePaths.length >= maxFilePaths) {
        truncated = true;
        return;
      }

      const relativePath = relDir ? `${relDir}/${ent.name}` : ent.name;
      if (!isPathVisible(relativePath)) continue;

      if (ent.isDirectory()) {
        if (isPathIgnoredByRuleSets(ruleSets, relativePath)) continue;

        const syncMode = classifyDirectorySyncMode(ent.name, {
          relativePath,
          immediateSiblingCount: siblingCount,
          immediateChildCount: dirents.length,
        });
        if (syncMode === 'hidden') continue;

        directoryStubs.push(relativePath);
        if (syncMode === 'shallow') continue;

        await visitDir(relativePath, ruleSets, dirents.length);
      } else if (ent.isFile()) {
        if (isPathIgnoredByRuleSets(ruleSets, relativePath)) continue;
        filePaths.push(relativePath);
        if (filePaths.length >= maxFilePaths) truncated = true;
      }
    }
  }

  await visitDir('', [], 0);
  return { filePaths, directoryStubs, truncated };
}
