'use client';

import { useMemo } from 'react';

import type { FileEntry } from '@/modules/chatroom/components/FileSelector/useFileSelector';

interface TreeResult {
  treeJson?: string | null;
  entries?: FileEntry[];
}

function filterEntries(entries: FileEntry[], includeDirectories?: boolean): FileEntry[] {
  if (includeDirectories) {
    return entries.filter((e) => e.type === 'file' || e.type === 'directory');
  }
  return entries.filter((e) => e.type === 'file');
}

/** Parse a file tree result into FileEntry items. */
// fallow-ignore-next-line complexity
export function useFileEntries(
  treeResult: TreeResult | null | undefined,
  options?: { includeDirectories?: boolean }
): FileEntry[] {
  // fallow-ignore-next-line complexity
  return useMemo(() => {
    if (treeResult?.entries?.length) {
      return filterEntries(treeResult.entries, options?.includeDirectories);
    }

    if (!treeResult?.treeJson) return [];
    try {
      const tree = JSON.parse(treeResult.treeJson);
      const entries = (tree.entries ?? []) as FileEntry[];
      return filterEntries(entries, options?.includeDirectories);
    } catch {
      return [];
    }
  }, [treeResult?.treeJson, treeResult?.entries, options?.includeDirectories]);
}
