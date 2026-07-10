import path from 'node:path';
// fallow-ignore-file complexity

import { watch, type FSWatcher } from 'chokidar';

import { hasExcludedDirSegment, isPathVisible } from './workspace-visibility-policy.js';

const DEFAULT_DEBOUNCE_MS = 250;

export type WorkspaceFsEventKind = 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir';

export interface WorkspaceFsEvent {
  kind: WorkspaceFsEventKind;
  path: string;
}

export interface WorkspaceFsWatcherOptions {
  workingDir: string;
  onEvents: (events: WorkspaceFsEvent[]) => void | Promise<void>;
  shouldIgnore?: (relativePath: string) => boolean;
  onError?: (error: unknown) => void;
  debounceMs?: number;
}

export interface WorkspaceFsWatcherHandle {
  ready: Promise<void>;
  stop: () => Promise<void>;
}

function toRelativePath(rootDir: string, absolutePath: string): string {
  return path
    .relative(rootDir, absolutePath)
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '');
}

export function createWorkspaceFsWatcher(
  options: WorkspaceFsWatcherOptions
): WorkspaceFsWatcherHandle {
  const absWorkingDir = path.resolve(options.workingDir);
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  let stopped = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingEvents = new Map<string, WorkspaceFsEvent>();

  const scheduleFlush = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (pendingEvents.size === 0 || stopped) return;
      const events = [...pendingEvents.values()].sort((a, b) => a.path.localeCompare(b.path));
      pendingEvents.clear();
      void Promise.resolve(options.onEvents(events)).catch((error: unknown) => {
        options.onError?.(error);
      });
    }, debounceMs);
    debounceTimer.unref?.();
  };

  const enqueue = (kind: WorkspaceFsEventKind, absolutePath: string): void => {
    if (stopped) return;
    const relativePath = toRelativePath(absWorkingDir, absolutePath);
    if (!relativePath || !isPathVisible(relativePath) || hasExcludedDirSegment(relativePath))
      return;
    if (options.shouldIgnore?.(relativePath)) return;
    pendingEvents.set(relativePath, { kind, path: relativePath });
    scheduleFlush();
  };

  const watcher: FSWatcher = watch(absWorkingDir, {
    ignored: (watchPath) => {
      const relativePath = toRelativePath(absWorkingDir, watchPath);
      if (!relativePath) return false;
      return (
        !isPathVisible(relativePath) ||
        hasExcludedDirSegment(relativePath) ||
        options.shouldIgnore?.(relativePath) === true
      );
    },
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 25 },
  });
  watcher
    .on('add', (filePath) => enqueue('add', filePath))
    .on('addDir', (filePath) => enqueue('addDir', filePath))
    .on('change', (filePath) => enqueue('change', filePath))
    .on('unlink', (filePath) => enqueue('unlink', filePath))
    .on('unlinkDir', (filePath) => enqueue('unlinkDir', filePath))
    .on('error', (error) => options.onError?.(error));

  const ready = new Promise<void>((resolve) => {
    watcher.once('ready', resolve);
  });

  return {
    ready,
    stop: async () => {
      stopped = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      pendingEvents.clear();
      await watcher.close();
    },
  };
}
