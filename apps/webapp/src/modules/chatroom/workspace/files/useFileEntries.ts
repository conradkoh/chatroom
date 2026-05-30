'use client';

import { useMemo } from 'react';
import type { FileEntry } from '@/modules/chatroom/components/FileSelector/useFileSelector';

interface TreeResult {
  treeJson: string | null;
}

/** Parse a file tree result into FileEntry items. */
export function useFileEntries(
  treeResult: TreeResult | null | undefined,
  options?: { includeDirectories?: boolean }
): FileEntry[] {
  return useMemo(() => {
    if (!treeResult?.treeJson) return [];
    try {
      const tree = JSON.parse(treeResult.treeJson);
      const entries = (tree.entries ?? []) as FileEntry[];
      if (options?.includeDirectories) {
        return entries.filter((e) => e.type === 'file' || e.type === 'directory');
      }
      return entries.filter((e) => e.type === 'file');
    } catch {
      return [];
    }
  }, [treeResult?.treeJson, options?.includeDirectories]);
}
