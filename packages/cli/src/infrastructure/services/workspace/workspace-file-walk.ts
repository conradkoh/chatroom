import {
  isPathIgnoredByRuleSets,
  loadDirectoryIgnoreRuleSets,
  mergeWorkspaceIgnoreRuleSets,
  readWorkspaceDirectoryDirents,
  type WorkspaceIgnoreRuleSet,
} from './workspace-ignore.js';
import { classifyDirectorySyncMode, isPathVisible } from './workspace-visibility-policy.js';

export type WalkWorkspaceFilesOptions = {
  maxFilePaths?: number | undefined;
};

export type WalkWorkspaceFilesResult = {
  filePaths: string[];
  /** Directory paths that should appear in the tree even when children are not synced. */
  directoryStubs: string[];
  truncated: boolean;
};

/**
 * Walk workspace filesystem breadth-first, collecting immediate files by depth.
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

  type WalkFrame = {
    relDir: string;
    inheritedRuleSets: readonly WorkspaceIgnoreRuleSet[];
    siblingCount: number;
  };
  let currentLevel: WalkFrame[] = [{ relDir: '', inheritedRuleSets: [], siblingCount: 0 }];
  while (currentLevel.length > 0) {
    if (filePaths.length >= maxFilePaths) {
      truncated = true;
      break;
    }
    const nextLevel: WalkFrame[] = [];
    for (const frame of currentLevel) {
      if (filePaths.length >= maxFilePaths) {
        truncated = true;
        break;
      }
      const localRuleSets = await loadDirectoryIgnoreRuleSets(rootDir, frame.relDir);
      const ruleSets = mergeWorkspaceIgnoreRuleSets(frame.inheritedRuleSets, localRuleSets);
      const dirents = await readWorkspaceDirectoryDirents(rootDir, frame.relDir);
      if (!dirents) continue;
      for (const ent of dirents) {
        const relativePath = frame.relDir ? `${frame.relDir}/${ent.name}` : ent.name;
        if (!isPathVisible(relativePath)) continue;
        if (ent.isDirectory()) {
          if (isPathIgnoredByRuleSets(ruleSets, relativePath)) continue;
          const syncMode = classifyDirectorySyncMode(ent.name, {
            relativePath,
            immediateSiblingCount: frame.siblingCount,
            immediateChildCount: dirents.length,
          });
          if (syncMode === 'hidden') continue;
          directoryStubs.push(relativePath);
          if (syncMode === 'full')
            nextLevel.push({
              relDir: relativePath,
              inheritedRuleSets: ruleSets,
              siblingCount: dirents.length,
            });
        } else if (ent.isFile() && !isPathIgnoredByRuleSets(ruleSets, relativePath)) {
          if (filePaths.length >= maxFilePaths) {
            truncated = true;
            continue;
          }
          filePaths.push(relativePath);
          if (filePaths.length >= maxFilePaths) truncated = true;
        }
      }
    }
    currentLevel = truncated ? [] : nextLevel;
  }
  return { filePaths, directoryStubs, truncated };
}
