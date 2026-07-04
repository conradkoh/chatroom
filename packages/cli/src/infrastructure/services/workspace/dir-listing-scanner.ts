/**
 * FS-authoritative single-directory listing for workspace explorer.
 */

import { promises as fsPromises } from 'node:fs';
import path from 'node:path';

import type {
  DirListing,
  DirListingEntry,
} from '@workspace/backend/src/domain/entities/workspace-files.js';

import { isPathInsideRoot } from './workspace-path-security.js';
import {
  filterGitIgnored,
  isAlwaysExcludedDirName,
  isPathVisible,
} from './workspace-visibility-policy.js';

const DEFAULT_MAX_ENTRIES = 500;

// fallow-ignore-next-line complexity
export async function listDirectory(
  rootDir: string,
  dirPath: string,
  options?: { maxEntries?: number }
): Promise<DirListing> {
  const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const scannedAt = Date.now();

  const absDir = dirPath ? path.join(rootDir, dirPath) : rootDir;
  const resolvedRoot = path.resolve(rootDir);
  const resolvedDir = path.resolve(absDir);

  if (!isPathInsideRoot(resolvedRoot, resolvedDir)) {
    return { dirPath, entries: [], scannedAt, truncated: false, totalCount: 0 };
  }

  let dirents;
  try {
    dirents = await fsPromises.readdir(absDir, { withFileTypes: true });
  } catch {
    return { dirPath, entries: [], scannedAt, truncated: false, totalCount: 0 };
  }

  const candidates: DirListingEntry[] = [];

  for (const ent of dirents) {
    if (isAlwaysExcludedDirName(ent.name)) continue;

    const relativePath = dirPath ? `${dirPath}/${ent.name}` : ent.name;
    if (!isPathVisible(relativePath)) continue;

    if (ent.isDirectory()) {
      candidates.push({ name: ent.name, path: relativePath, type: 'directory' });
    } else if (ent.isFile()) {
      let size: number | undefined;
      try {
        const st = await fsPromises.stat(path.join(absDir, ent.name));
        size = st.size;
      } catch {
        // ignore unreadable stat
      }
      candidates.push({ name: ent.name, path: relativePath, type: 'file', size });
    }
  }

  const ignored = await filterGitIgnored(
    rootDir,
    candidates.map((c) => c.path)
  );
  const visible = candidates.filter((c) => !ignored.has(c.path));

  // fallow-ignore-next-line complexity
  visible.sort((a, b) => {
    if (a.type === 'directory' && b.type === 'file') return -1;
    if (a.type === 'file' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  const totalCount = visible.length;
  const truncated = totalCount > maxEntries;
  const entries = visible.slice(0, maxEntries);

  return { dirPath, entries, scannedAt, truncated, totalCount };
}
