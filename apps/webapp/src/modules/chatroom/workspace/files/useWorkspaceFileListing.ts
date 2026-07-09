'use client';

import { useWorkspaceFileTreeEntries } from './useWorkspaceFileTreeEntries';

import type { FileEntry } from '@/modules/chatroom/components/FileSelector/useFileSelector';

export interface UseWorkspaceFileListingArgs {
  machineId: string;
  workingDir: string;
  enabled?: boolean;
  /** Include directories in entries (for @ autocomplete). Default false. */
  includeDirectories?: boolean;
}

export interface UseWorkspaceFileListingResult {
  entries: FileEntry[];
  refresh: (options?: { force?: boolean }) => void;
  isLoading: boolean;
}

// fallow-ignore-next-line unused-export
export function useWorkspaceFileListing(
  args: UseWorkspaceFileListingArgs
): UseWorkspaceFileListingResult {
  const result = useWorkspaceFileTreeEntries(args);
  return {
    entries: result.entries,
    refresh: result.refresh,
    isLoading: result.isLoading,
  };
}
