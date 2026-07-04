/**
 * Bounded workspace file search for explorer filter and file selector.
 */

import { promises as fsPromises, type Dirent } from 'node:fs';
import path from 'node:path';

import type { FileSearchResult } from '@workspace/backend/src/domain/entities/workspace-files.js';

import {
  filterGitIgnored,
  isAlwaysExcludedDirName,
  isPathVisible,
} from './workspace-visibility-policy.js';

const DEFAULT_MAX_RESULTS = 300;
const MAX_VISIT_DIRS = 2000;

// fallow-ignore-next-line complexity
export async function searchWorkspaceFiles(
  rootDir: string,
  query: string,
  options?: { maxResults?: number }
): Promise<FileSearchResult> {
  const maxResults = options?.maxResults ?? DEFAULT_MAX_RESULTS;
  const scannedAt = Date.now();
  const normalizedQuery = query.trim().toLowerCase();

  const matches: { path: string; type: 'file' }[] = [];
  let visitedDirs = 0;
  let truncated = false;

  // fallow-ignore-next-line complexity
  async function visitDir(relDir: string): Promise<void> {
    if (visitedDirs >= MAX_VISIT_DIRS || matches.length >= maxResults) {
      truncated = true;
      return;
    }
    visitedDirs++;

    const absDir = relDir ? path.join(rootDir, relDir) : rootDir;
    let dirents: Dirent[];
    try {
      dirents = await fsPromises.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }

    const fileCandidates: string[] = [];
    const subdirs: string[] = [];

    for (const ent of dirents) {
      if (isAlwaysExcludedDirName(ent.name)) continue;
      const relativePath = relDir ? `${relDir}/${ent.name}` : ent.name;
      if (!isPathVisible(relativePath)) continue;

      if (ent.isDirectory()) {
        subdirs.push(relativePath);
      } else if (ent.isFile()) {
        fileCandidates.push(relativePath);
      }
    }

    const ignored = await filterGitIgnored(rootDir, fileCandidates);
    for (const filePath of fileCandidates) {
      if (ignored.has(filePath)) continue;
      const fileName = path.basename(filePath).toLowerCase();
      if (normalizedQuery === '' || fileName.includes(normalizedQuery)) {
        matches.push({ path: filePath, type: 'file' });
        if (matches.length >= maxResults) {
          truncated = true;
          return;
        }
      }
    }

    for (const sub of subdirs) {
      if (matches.length >= maxResults || visitedDirs >= MAX_VISIT_DIRS) {
        truncated = true;
        return;
      }
      await visitDir(sub);
    }
  }

  await visitDir('');

  return {
    query,
    entries: matches,
    scannedAt,
    truncated,
    totalCount: matches.length,
  };
}
