import { discoverGitWorkspaceHierarchy } from './git-workspace-hierarchy.js';
import {
  createWorkspaceFsWatcher,
  type WorkspaceFsEvent,
  type WorkspaceFsWatcherHandle,
  type WorkspaceFsWatcherOptions,
} from './workspace-fs-watcher.js';

export type { WorkspaceFsEvent };

export type WorkspaceChangeSourceOptions = WorkspaceFsWatcherOptions;

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
    // Slice 3 will return a git polling source when hierarchy is available.
    // Until then, fall back to fs so discovery can ship without breaking callers.
  }
  return {
    mode: 'fs',
    source: createWorkspaceFsWatcher(options),
  };
}
