import { createGitWorkspaceChangeSource } from './git-workspace-change-source.js';
import { discoverGitWorkspaceHierarchy } from './git-workspace-hierarchy.js';
import {
  createWorkspaceFsWatcher,
  type WorkspaceFsEvent,
  type WorkspaceFsWatcherHandle,
  type WorkspaceFsWatcherOptions,
} from './workspace-fs-watcher.js';

export type { WorkspaceFsEvent };

export type WorkspaceChangeSourceOptions = WorkspaceFsWatcherOptions & {
  pollIntervalMs?: number;
  onNeedsReconcile?: () => void | Promise<void>;
};

export type WorkspaceChangeSource = WorkspaceFsWatcherHandle;

export type WorkspaceChangeSourceMode = 'git' | 'fs';

export interface WorkspaceChangeSourceResult {
  mode: WorkspaceChangeSourceMode;
  source: WorkspaceChangeSource;
}

export async function createWorkspaceChangeSource(
  options: WorkspaceChangeSourceOptions
): Promise<WorkspaceChangeSourceResult> {
  const hierarchy = await discoverGitWorkspaceHierarchy(options.workingDir);
  if (hierarchy !== null) {
    return {
      mode: 'git',
      source: createGitWorkspaceChangeSource({ ...options, hierarchy }),
    };
  }
  return {
    mode: 'fs',
    source: createWorkspaceFsWatcher(options),
  };
}
