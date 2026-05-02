'use client';

import { useMemo } from 'react';

import type { FileEntry } from '../components/FileSelector/useFileSelector';

interface TreeResult {
  treeJson: string | null;
}

/** Parse a file tree result into an array of FileEntry items (files only). */
export function useFileEntries(treeResult: TreeResult | null | undefined): FileEntry[] {
  return useMemo(() => {
    if (!treeResult?.treeJson) return [];
    try {
      const tree = JSON.parse(treeResult.treeJson);
      return ((tree.entries ?? []) as FileEntry[]).filter((e) => e.type === 'file');
    } catch {
      return [];
    }
  }, [treeResult?.treeJson]);
}
