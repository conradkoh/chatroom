import {
  createGitWorkspaceChangeSource,
  type GitRootSnapshotReader,
} from './git-workspace-change-source.js';
import { discoverGitWorkspaceHierarchy } from './git-workspace-hierarchy.js';
import type { GitRepoNode } from './git-workspace-hierarchy.js';
import {
  createWorkspaceFsWatcher,
  type WorkspaceFsWatcherHandle,
  type WorkspaceFsWatcherOptions,
} from './workspace-fs-watcher.js';
import type { WorkspacePathType } from './workspace-sync-state.js';

export type WorkspaceChangeSourceOptions = WorkspaceFsWatcherOptions & {
  pollIntervalMs?: number | undefined;
  onNeedsReconcile?: (() => void | Promise<void>) | undefined;
  onPersistentFailure?: (() => void | Promise<void>) | undefined;
  getKnownPaths?: (() => Readonly<Record<string, WorkspacePathType>>) | undefined;
  /** Git mode only, root node only. Nested nodes and fs mode ignore it. */
  readRootSnapshot?: GitRootSnapshotReader | undefined;
};

export type WorkspaceChangeSource = WorkspaceFsWatcherHandle;

export type WorkspaceChangeSourceMode = 'git' | 'fs';

export interface WorkspaceChangeSourceResult {
  mode: WorkspaceChangeSourceMode;
  source: WorkspaceChangeSource;
  gitRepoCount?: number | undefined;
}

function countGitRepoNodes(root: GitRepoNode): number {
  return 1 + root.children.reduce((sum, child) => sum + countGitRepoNodes(child), 0);
}

export async function createWorkspaceChangeSource(
  options: WorkspaceChangeSourceOptions
): Promise<WorkspaceChangeSourceResult> {
  const hierarchy = await discoverGitWorkspaceHierarchy(options.workingDir);
  if (hierarchy !== null) {
    return {
      mode: 'git',
      source: createGitWorkspaceChangeSource({ ...options, hierarchy }),
      gitRepoCount: countGitRepoNodes(hierarchy.root),
    };
  }
  return {
    mode: 'fs',
    source: createWorkspaceFsWatcher(options),
  };
}
