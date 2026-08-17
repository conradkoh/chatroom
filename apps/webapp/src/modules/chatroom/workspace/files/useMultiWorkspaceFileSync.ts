'use client';
// fallow-ignore-file code-duplication complexity

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { fileTreeEntriesToFileEntries } from './fileTreeUtils';
import {
  MAX_MULTI_WORKSPACE_SLOTS,
  multiWorkspaceSlotsKey,
  prepareMultiWorkspaceSlots,
  tagFileEntriesWithWorkspaceId,
} from './multiWorkspaceSlots';
import { requestWorkspaceFileTreeRefresh } from './workspaceFileTreeRefreshCoordinator';
import {
  getWorkspaceFileTreeEntries,
  subscribeWorkspaceFileTree,
  toWorkspaceFileTreeKey,
} from '../stores/workspaceFileTreeStore';

import type { FileEntry } from '@/modules/chatroom/components/FileSelector/useFileSelector';
import type { Workspace } from '@/modules/chatroom/types/workspace';

export interface UseMultiWorkspaceFileSyncResult {
  files: FileEntry[];
  refreshAll: (options?: { force?: boolean }) => void;
}

function useSlotStoreFiles(
  machineId: string,
  workingDir: string,
  workspaceId: string | undefined,
  slotActive: boolean
): FileEntry[] {
  const workspaceKey = toWorkspaceFileTreeKey(machineId, workingDir);

  const storeEntries = useSyncExternalStore(
    useCallback((listener) => subscribeWorkspaceFileTree(workspaceKey, listener), [workspaceKey]),
    () => getWorkspaceFileTreeEntries(workspaceKey),
    () => getWorkspaceFileTreeEntries(workspaceKey)
  );

  return useMemo(() => {
    if (!slotActive) return [];
    return tagFileEntriesWithWorkspaceId(fileTreeEntriesToFileEntries(storeEntries), workspaceId);
  }, [slotActive, storeEntries, workspaceId]);
}

/**
 * Dashboard autocomplete hook: reads cached store entries without ambient producers.
 * `refreshAll` nudges the daemon via the shared refresh coordinator.
 */
export function useMultiWorkspaceFileSync(
  workspaces: Workspace[]
): UseMultiWorkspaceFileSyncResult {
  const workspaceSlotsKey = multiWorkspaceSlotsKey(workspaces);
  const slots = useMemo(() => prepareMultiWorkspaceSlots(workspaces), [workspaceSlotsKey]);

  const slot0 = slots[0];
  const slot1 = slots[1];
  const slot2 = slots[2];
  const slot3 = slots[3];
  const slot4 = slots[4];
  const slot5 = slots[5];
  const slot6 = slots[6];
  const slot7 = slots[7];
  const slot8 = slots[8];
  const slot9 = slots[9];

  const files0 = useSlotStoreFiles(
    slot0?.machineId ?? '',
    slot0?.workingDir ?? '',
    slot0?.workspaceId,
    !!slot0
  );
  const files1 = useSlotStoreFiles(
    slot1?.machineId ?? '',
    slot1?.workingDir ?? '',
    slot1?.workspaceId,
    !!slot1
  );
  const files2 = useSlotStoreFiles(
    slot2?.machineId ?? '',
    slot2?.workingDir ?? '',
    slot2?.workspaceId,
    !!slot2
  );
  const files3 = useSlotStoreFiles(
    slot3?.machineId ?? '',
    slot3?.workingDir ?? '',
    slot3?.workspaceId,
    !!slot3
  );
  const files4 = useSlotStoreFiles(
    slot4?.machineId ?? '',
    slot4?.workingDir ?? '',
    slot4?.workspaceId,
    !!slot4
  );
  const files5 = useSlotStoreFiles(
    slot5?.machineId ?? '',
    slot5?.workingDir ?? '',
    slot5?.workspaceId,
    !!slot5
  );
  const files6 = useSlotStoreFiles(
    slot6?.machineId ?? '',
    slot6?.workingDir ?? '',
    slot6?.workspaceId,
    !!slot6
  );
  const files7 = useSlotStoreFiles(
    slot7?.machineId ?? '',
    slot7?.workingDir ?? '',
    slot7?.workspaceId,
    !!slot7
  );
  const files8 = useSlotStoreFiles(
    slot8?.machineId ?? '',
    slot8?.workingDir ?? '',
    slot8?.workspaceId,
    !!slot8
  );
  const files9 = useSlotStoreFiles(
    slot9?.machineId ?? '',
    slot9?.workingDir ?? '',
    slot9?.workspaceId,
    !!slot9
  );

  const slotFiles = [
    files0,
    files1,
    files2,
    files3,
    files4,
    files5,
    files6,
    files7,
    files8,
    files9,
  ];

  const requestMutation = useSessionMutation(api.workspaceFiles.requestFileTree);

  const refreshAll = useCallback(
    (options?: { force?: boolean }) => {
      const force = !!options?.force;
      for (let i = 0; i < MAX_MULTI_WORKSPACE_SLOTS; i++) {
        const slot = slots[i];
        if (!slot) continue;
        requestWorkspaceFileTreeRefresh({
          workspaceKey: toWorkspaceFileTreeKey(slot.machineId, slot.workingDir),
          machineId: slot.machineId,
          workingDir: slot.workingDir,
          force,
          request: (args) =>
            requestMutation({
              machineId: args.machineId,
              workingDir: args.workingDir,
              ...(args.force ? { force: true } : {}),
            }).catch(() => {}),
        });
      }
    },
    [slots, requestMutation]
  );

  const files = useMemo(() => {
    const merged: FileEntry[] = [];
    for (const slotFilesGroup of slotFiles) {
      if (slotFilesGroup.length > 0) {
        merged.push(...slotFilesGroup);
      }
    }
    return merged;
  }, [slotFiles]);

  return useMemo(() => ({ files, refreshAll }), [files, refreshAll]);
}
