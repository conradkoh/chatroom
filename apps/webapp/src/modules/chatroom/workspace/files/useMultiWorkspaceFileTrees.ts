'use client';
// fallow-ignore-file complexity

import { useCallback, useEffect, useMemo } from 'react';

import { useWorkspaceFileTree } from './useWorkspaceFileTree';

import { normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';
import type { Workspace } from '@/modules/chatroom/types/workspace';

const MAX_WORKSPACES = 10;

interface WorkspaceSlot {
  machineId: string;
  workingDir: string;
}

function prepareSlots(workspaces: Workspace[]): (WorkspaceSlot | null)[] {
  const slots: (WorkspaceSlot | null)[] = [];
  for (let i = 0; i < MAX_WORKSPACES; i++) {
    const ws = workspaces[i];
    if (ws?.machineId && ws.workingDir) {
      slots.push({
        machineId: ws.machineId,
        workingDir: normalizeWorkspaceWorkingDir(ws.workingDir),
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
  };
}

// fallow-ignore-next-line unused-export
export function useMultiWorkspaceFileTrees(workspaces: Workspace[]): {
  refreshAll: (options?: { force?: boolean }) => void;
} {
  const workspaceSlotsKey = JSON.stringify(
    workspaces.slice(0, MAX_WORKSPACES).map((w) => `${w.machineId}::${w.workingDir}`)
  );
  // fallow-ignore-next-line code-duplication
  const slots = useMemo(() => prepareSlots(workspaces), [workspaceSlotsKey]);

  const tree0 = useWorkspaceFileTree(slotToArgs(slots[0]));
  const tree1 = useWorkspaceFileTree(slotToArgs(slots[1]));
  const tree2 = useWorkspaceFileTree(slotToArgs(slots[2]));
  const tree3 = useWorkspaceFileTree(slotToArgs(slots[3]));
  const tree4 = useWorkspaceFileTree(slotToArgs(slots[4]));
  const tree5 = useWorkspaceFileTree(slotToArgs(slots[5]));
  const tree6 = useWorkspaceFileTree(slotToArgs(slots[6]));
  const tree7 = useWorkspaceFileTree(slotToArgs(slots[7]));
  const tree8 = useWorkspaceFileTree(slotToArgs(slots[8]));
  const tree9 = useWorkspaceFileTree(slotToArgs(slots[9]));

  const trees = [tree0, tree1, tree2, tree3, tree4, tree5, tree6, tree7, tree8, tree9];

  const refreshAll = useCallback(
    (options?: { force?: boolean }) => {
      for (const tree of trees) {
        tree.refresh(options);
      }
    },
    [
      tree0.refresh,
      tree1.refresh,
      tree2.refresh,
      tree3.refresh,
      tree4.refresh,
      tree5.refresh,
      tree6.refresh,
      tree7.refresh,
      tree8.refresh,
      tree9.refresh,
    ]
  );

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  return useMemo(() => ({ refreshAll }), [refreshAll]);
}
