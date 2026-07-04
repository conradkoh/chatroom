import { hasExcludedDirSegment } from './workspace-visibility-policy.js';

/** Parent dir of a relative path; '' for root-level files. */
function parentDirPath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx === -1 ? '' : normalized.slice(0, idx);
}

/** Skip watcher events under excluded dirs (.git, node_modules, …). */
export function shouldIgnoreWatchRelativePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized || normalized === '.') return false;
  return hasExcludedDirSegment(normalized);
}

/**
 * Directory listings to refresh for a FS event.
 * @param relativePath — path relative to workspace root (no leading slash)
 * @param isDirectory — from watcher event when known; default false
 */
export function dirsToRefreshForEvent(relativePath: string, isDirectory = false): string[] {
  const normalized = relativePath.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized || normalized === '.') return [''];

  const dirs = new Set<string>();
  dirs.add(parentDirPath(normalized));
  if (isDirectory) dirs.add(normalized);
  return [...dirs];
}

/** Keep only dirs present in the active watch set. */
export function filterDirsByActiveSet(
  dirs: string[],
  activeDirPaths: ReadonlySet<string>
): string[] {
  return dirs.filter((d) => activeDirPaths.has(d));
}
