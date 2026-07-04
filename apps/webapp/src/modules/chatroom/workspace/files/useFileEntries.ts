'use client';

import { useMemo } from 'react';

import type { FileEntry } from '@/modules/chatroom/components/FileSelector/useFileSelector';

interface EntriesResult {
  entries?: FileEntry[];
}

function filterEntries(entries: FileEntry[], includeDirectories?: boolean): FileEntry[] {
  if (includeDirectories) {
    return entries.filter((e) => e.type === 'file' || e.type === 'directory');
  }
  return entries.filter((e) => e.type === 'file');
}

/** Parse workspace file listing entries for display. */
export function useFileEntries(
  result: EntriesResult | null | undefined,
  options?: { includeDirectories?: boolean }
): FileEntry[] {
  return useMemo(() => {
    if (!result?.entries?.length) return [];
    return filterEntries(result.entries, options?.includeDirectories);
  }, [result?.entries, options?.includeDirectories]);
}
