import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
// fallow-ignore-file complexity

import {
  dirsToRefreshForEvent,
  filterDirsByActiveSet,
  shouldIgnoreWatchRelativePath,
} from './workspace-fs-watch-paths.js';

const DEFAULT_DEBOUNCE_MS = 400;

export interface WorkspaceFsWatcherOptions {
  workingDir: string;
  activeDirPaths: ReadonlySet<string>;
  onRefreshDirs: (dirPaths: string[]) => void | Promise<void>;
  debounceMs?: number;
}

export interface WorkspaceFsWatcherHandle {
  updateActiveDirPaths: (paths: ReadonlySet<string>) => void;
  stop: () => void;
}

function isRecursiveWatchPlatform(): boolean {
  return process.platform === 'darwin' || process.platform === 'win32';
}

function normalizeFilename(filename: string | Buffer | null | undefined): string | null {
  if (filename == null) return null;
  const value = typeof filename === 'string' ? filename : filename.toString();
  if (!value || value === '.' || value === '..') return null;
  return value.replace(/\\/g, '/');
}

export function createWorkspaceFsWatcher(
  options: WorkspaceFsWatcherOptions
): WorkspaceFsWatcherHandle {
  const absWorkingDir = path.resolve(options.workingDir);
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  let activeDirPaths = new Set(options.activeDirPaths);
  let stopped = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingDirs = new Set<string>();
  let rootWatcher: FSWatcher | null = null;
  const dirWatchers = new Map<string, FSWatcher>();

  const scheduleFlush = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (pendingDirs.size === 0) return;
      const dirs = [...pendingDirs];
      pendingDirs.clear();
      void Promise.resolve(options.onRefreshDirs(dirs));
    }, debounceMs);
    debounceTimer.unref?.();
  };

  const enqueueDirs = (dirs: string[]): void => {
    for (const dir of dirs) pendingDirs.add(dir);
    scheduleFlush();
  };

  const handleRelativePath = (relativePath: string, isDirectory = false): void => {
    if (stopped) return;
    if (shouldIgnoreWatchRelativePath(relativePath)) return;
    const toRefresh = filterDirsByActiveSet(
      dirsToRefreshForEvent(relativePath, isDirectory),
      activeDirPaths
    );
    if (toRefresh.length > 0) enqueueDirs(toRefresh);
  };

  const onWatchEvent = (
    watchedDirPath: string,
    filename: string | Buffer | null | undefined
  ): void => {
    const normalizedFilename = normalizeFilename(filename);
    if (!normalizedFilename) return;

    let relativePath: string;
    if (isRecursiveWatchPlatform()) {
      relativePath = normalizedFilename;
    } else if (watchedDirPath === '') {
      relativePath = normalizedFilename;
    } else {
      relativePath = `${watchedDirPath}/${normalizedFilename}`;
    }

    const isDirectory = relativePath.endsWith('/');
    handleRelativePath(relativePath.replace(/\/+$/, ''), isDirectory);
  };

  const closePerDirWatchers = (): void => {
    for (const watcher of dirWatchers.values()) watcher.close();
    dirWatchers.clear();
  };

  const startPerDirWatch = (dirPath: string): void => {
    if (dirPath === '' || dirWatchers.has(dirPath)) return;
    const absDir = path.join(absWorkingDir, dirPath);
    const watcher = watch(absDir, (_eventType, filename) => {
      onWatchEvent(dirPath, filename);
    });
    dirWatchers.set(dirPath, watcher);
  };

  const rewirePerDirWatches = (): void => {
    const wanted = new Set<string>();
    for (const dirPath of activeDirPaths) {
      if (dirPath !== '') wanted.add(dirPath);
    }

    for (const [dirPath, watcher] of dirWatchers) {
      if (!wanted.has(dirPath)) {
        watcher.close();
        dirWatchers.delete(dirPath);
      }
    }

    for (const dirPath of wanted) {
      if (!dirWatchers.has(dirPath)) startPerDirWatch(dirPath);
    }
  };

  const startWatching = (): void => {
    if (isRecursiveWatchPlatform()) {
      rootWatcher = watch(absWorkingDir, { recursive: true }, (_eventType, filename) => {
        onWatchEvent('', filename);
      });
      return;
    }

    rootWatcher = watch(absWorkingDir, (_eventType, filename) => {
      onWatchEvent('', filename);
    });
    rewirePerDirWatches();
  };

  startWatching();

  return {
    updateActiveDirPaths: (paths: ReadonlySet<string>) => {
      activeDirPaths = new Set(paths);
      if (!isRecursiveWatchPlatform() && !stopped) {
        rewirePerDirWatches();
      }
    },
    stop: () => {
      stopped = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      rootWatcher?.close();
      rootWatcher = null;
      closePerDirWatchers();
      pendingDirs.clear();
    },
  };
}
