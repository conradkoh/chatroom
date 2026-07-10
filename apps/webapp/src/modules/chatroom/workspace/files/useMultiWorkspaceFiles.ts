'use client';
// fallow-ignore-file complexity

import { useCallback, useMemo } from 'react';

import { useWorkspaceFileTreeEntries } from './useWorkspaceFileTreeEntries';

import { encodeWorkspaceId, normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';
import type { FileEntry } from '@/modules/chatroom/components/FileSelector/useFileSelector';
import type { Workspace } from '@/modules/chatroom/types/workspace';

const MAX_WORKSPACES = 10;

interface WorkspaceSlot {
  machineId: string;
  workingDir: string;
  workspaceId: string;
}

interface UseMultiWorkspaceFilesResult {
  files: FileEntry[];
  refreshAll: (options?: { force?: boolean }) => void;
}

// fallow-ignore-next-line code-duplication
function prepareSlots(workspaces: Workspace[]): (WorkspaceSlot | null)[] {
  const slots: (WorkspaceSlot | null)[] = [];
  for (let i = 0; i < MAX_WORKSPACES; i++) {
    const ws = workspaces[i];
    if (ws && ws.machineId && ws.workingDir) {
      const workingDir = normalizeWorkspaceWorkingDir(ws.workingDir);
      slots.push({
        machineId: ws.machineId,
        workingDir,
        workspaceId: encodeWorkspaceId(ws.machineId, workingDir),
      });
    } else {
      slots.push(null);
    }
  }
  return slots;
}

function slotToArgs(slot: WorkspaceSlot | null | undefined) {
  return {
    machineId: slot?.machineId ?? '',
    workingDir: slot?.workingDir ?? '',
    enabled: !!slot,
    includeDirectories: true,
  };
}

function tagEntries(entries: FileEntry[], workspaceId: string | undefined): FileEntry[] {
  if (!workspaceId || entries.length === 0) return entries;
  return entries.map((e) => ({ ...e, workspaceId }));
}

export function useMultiWorkspaceFiles(workspaces: Workspace[]): UseMultiWorkspaceFilesResult {
  const workspaceSlotsKey = JSON.stringify(
    workspaces.slice(0, MAX_WORKSPACES).map((w) => `${w.machineId}::${w.workingDir}`)
  );
  const slots = useMemo(() => prepareSlots(workspaces), [workspaceSlotsKey]);

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
    for (let i = 0; i < MAX_WORKSPACES; i++) {
      const tagged = tagEntries(listings[i]?.entries ?? [], slots[i]?.workspaceId);
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
