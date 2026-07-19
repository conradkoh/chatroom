'use client';
// fallow-ignore-file complexity

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useMemo } from 'react';

import {
  MAX_MULTI_WORKSPACE_SLOTS,
  multiWorkspaceSlotsKey,
  prepareMultiWorkspaceSlots,
  tagFileEntriesWithWorkspaceId,
} from './multiWorkspaceSlots';
import { useWorkspaceFileTree } from './useWorkspaceFileTree';
import { requestWorkspaceFileTreeRefresh } from './workspaceFileTreeRefreshCoordinator';
import { toWorkspaceFileTreeKey } from '../stores/workspaceFileTreeStore';

import type { FileEntry } from '@/modules/chatroom/components/FileSelector/useFileSelector';
import type { Workspace } from '@/modules/chatroom/types/workspace';

export interface UseMultiWorkspaceFileSyncResult {
  files: FileEntry[];
  refreshAll: (options?: { force?: boolean }) => void;
}

function slotToProducerArgs(slot: ReturnType<typeof prepareMultiWorkspaceSlots>[number]) {
  return {
    machineId: slot?.machineId ?? '',
    workingDir: slot?.workingDir ?? '',
    enabled: !!slot,
  };
}

/**
 * Single dashboard hook: producer hydrates workspaceFileTreeStore from Convex;
 * `files` reads merged store entries; `refreshAll` nudges daemon via shared coordinator.
 */
export function useMultiWorkspaceFileSync(
  workspaces: Workspace[]
): UseMultiWorkspaceFileSyncResult {
  const workspaceSlotsKey = multiWorkspaceSlotsKey(workspaces);
  const slots = useMemo(() => prepareMultiWorkspaceSlots(workspaces), [workspaceSlotsKey]);

  const tree0 = useWorkspaceFileTree(slotToProducerArgs(slots[0]));
  const tree1 = useWorkspaceFileTree(slotToProducerArgs(slots[1]));
  const tree2 = useWorkspaceFileTree(slotToProducerArgs(slots[2]));
  const tree3 = useWorkspaceFileTree(slotToProducerArgs(slots[3]));
  const tree4 = useWorkspaceFileTree(slotToProducerArgs(slots[4]));
  const tree5 = useWorkspaceFileTree(slotToProducerArgs(slots[5]));
  const tree6 = useWorkspaceFileTree(slotToProducerArgs(slots[6]));
  const tree7 = useWorkspaceFileTree(slotToProducerArgs(slots[7]));
  const tree8 = useWorkspaceFileTree(slotToProducerArgs(slots[8]));
  const tree9 = useWorkspaceFileTree(slotToProducerArgs(slots[9]));

  const trees = [tree0, tree1, tree2, tree3, tree4, tree5, tree6, tree7, tree8, tree9];

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
    for (let i = 0; i < MAX_MULTI_WORKSPACE_SLOTS; i++) {
      const tagged = tagFileEntriesWithWorkspaceId(trees[i]?.entries ?? [], slots[i]?.workspaceId);
      if (tagged.length > 0) {
        merged.push(...tagged);
      }
    }
    return merged;
  }, [
    tree0.entries,
    tree1.entries,
    tree2.entries,
    tree3.entries,
    tree4.entries,
    tree5.entries,
    tree6.entries,
    tree7.entries,
    tree8.entries,
    tree9.entries,
    slots,
  ]);

  return useMemo(() => ({ files, refreshAll }), [files, refreshAll]);
}
