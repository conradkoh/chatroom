'use client';
// fallow-ignore-file complexity

import { useCallback, useMemo } from 'react';

import {
  MAX_MULTI_WORKSPACE_SLOTS,
  multiWorkspaceSlotsKey,
  prepareMultiWorkspaceSlots,
  tagFileEntriesWithWorkspaceId,
} from './multiWorkspaceSlots';
import { useWorkspaceFileTreeEntries } from './useWorkspaceFileTreeEntries';

import type { FileEntry } from '@/modules/chatroom/components/FileSelector/useFileSelector';
import type { Workspace } from '@/modules/chatroom/types/workspace';

interface UseMultiWorkspaceFilesResult {
  files: FileEntry[];
  refreshAll: (options?: { force?: boolean }) => void;
}

function slotToArgs(slot: ReturnType<typeof prepareMultiWorkspaceSlots>[number]) {
  return {
    machineId: slot?.machineId ?? '',
    workingDir: slot?.workingDir ?? '',
    enabled: !!slot,
    includeDirectories: true,
  };
}

// fallow-ignore-next-line unused-export
export function useMultiWorkspaceFiles(workspaces: Workspace[]): UseMultiWorkspaceFilesResult {
  const workspaceSlotsKey = multiWorkspaceSlotsKey(workspaces);
  const slots = useMemo(() => prepareMultiWorkspaceSlots(workspaces), [workspaceSlotsKey]);

  const listing0 = useWorkspaceFileTreeEntries(slotToArgs(slots[0]));
  const listing1 = useWorkspaceFileTreeEntries(slotToArgs(slots[1]));
  const listing2 = useWorkspaceFileTreeEntries(slotToArgs(slots[2]));
  const listing3 = useWorkspaceFileTreeEntries(slotToArgs(slots[3]));
  const listing4 = useWorkspaceFileTreeEntries(slotToArgs(slots[4]));
  const listing5 = useWorkspaceFileTreeEntries(slotToArgs(slots[5]));
  const listing6 = useWorkspaceFileTreeEntries(slotToArgs(slots[6]));
  const listing7 = useWorkspaceFileTreeEntries(slotToArgs(slots[7]));
  const listing8 = useWorkspaceFileTreeEntries(slotToArgs(slots[8]));
  const listing9 = useWorkspaceFileTreeEntries(slotToArgs(slots[9]));

  const listings = [
    listing0,
    listing1,
    listing2,
    listing3,
    listing4,
    listing5,
    listing6,
    listing7,
    listing8,
    listing9,
  ];

  const refreshAll = useCallback(
    (options?: { force?: boolean }) => {
      for (const listing of listings) {
        listing.refresh(options);
      }
    },
    [
      listing0.refresh,
      listing1.refresh,
      listing2.refresh,
      listing3.refresh,
      listing4.refresh,
      listing5.refresh,
      listing6.refresh,
      listing7.refresh,
      listing8.refresh,
      listing9.refresh,
    ]
  );

  const files = useMemo(() => {
    const merged: FileEntry[] = [];
    for (let i = 0; i < MAX_MULTI_WORKSPACE_SLOTS; i++) {
      const tagged = tagFileEntriesWithWorkspaceId(
        listings[i]?.entries ?? [],
        slots[i]?.workspaceId
      );
      if (tagged.length > 0) {
        merged.push(...tagged);
      }
    }
    return merged;
  }, [
    listing0.entries,
    listing1.entries,
    listing2.entries,
    listing3.entries,
    listing4.entries,
    listing5.entries,
    listing6.entries,
    listing7.entries,
    listing8.entries,
    listing9.entries,
    slots,
  ]);

  return useMemo(() => ({ files, refreshAll }), [files, refreshAll]);
}
