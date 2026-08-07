import type { FileEntry } from './useFileSelector';

import { fuzzyFilter } from '@/lib/fuzzyMatch';
import { getFileName } from '@/lib/pathUtils';

export const FILE_SELECTOR_ITEM_ROW_HEIGHT = 28;
export const FILE_SELECTOR_HEADING_ROW_HEIGHT = 28;

export type FileSelectorRow =
  | { type: 'heading'; id: string; label: string }
  | { type: 'item'; id: string; path: string; isRecent: boolean };

// fallow-ignore-next-line unused-export
export function scoreFileForSearch(path: string, search: string): number {
  const fileName = getFileName(path);
  return Math.max(fuzzyFilter(path, search, [fileName]), fuzzyFilter(fileName, search, [fileName]));
}

// fallow-ignore-next-line complexity
export function buildFileSelectorRows(
  files: FileEntry[],
  recentFiles: string[],
  search: string
): FileSelectorRow[] {
  const q = search.trim();
  const isSearching = q.length > 0;
  const rows: FileSelectorRow[] = [];

  if (isSearching) {
    const allPaths = new Set<string>();
    const scored: { path: string; score: number; isRecent: boolean }[] = [];
    for (const path of recentFiles) {
      if (allPaths.has(path)) continue;
      allPaths.add(path);
      const score = scoreFileForSearch(path, q);
      if (score > 0) scored.push({ path, score, isRecent: true });
    }
    for (const file of files) {
      if (allPaths.has(file.path)) continue;
      allPaths.add(file.path);
      const score = scoreFileForSearch(file.path, q);
      if (score > 0) scored.push({ path: file.path, score, isRecent: false });
    }
    scored.sort((a, b) => b.score - a.score);
    for (const { path, isRecent } of scored) {
      rows.push({
        type: 'item',
        id: isRecent ? `recent:${path}` : path,
        path,
        isRecent,
      });
    }
    return rows;
  }

  if (recentFiles.length > 0) {
    rows.push({ type: 'heading', id: 'recent', label: 'recently opened' });
    for (const path of recentFiles) {
      rows.push({ type: 'item', id: `recent:${path}`, path, isRecent: true });
    }
    rows.push({ type: 'heading', id: 'files', label: 'files' });
  }

  const recentSet = new Set(recentFiles);
  const displayFiles = recentFiles.length > 0 ? files.filter((f) => !recentSet.has(f.path)) : files;

  for (const file of displayFiles) {
    rows.push({ type: 'item', id: file.path, path: file.path, isRecent: false });
  }

  return rows;
}
