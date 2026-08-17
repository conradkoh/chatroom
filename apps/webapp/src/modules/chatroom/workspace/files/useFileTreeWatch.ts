'use client';
// fallow-ignore-file code-duplication

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useEffect, useMemo, useSyncExternalStore } from 'react';

import {
  MAX_MULTI_WORKSPACE_SLOTS,
  multiWorkspaceSlotsKey,
  prepareMultiWorkspaceSlots,
} from './multiWorkspaceSlots';
import { useWorkspaceFileTree } from './useWorkspaceFileTree';
import {
  getFileTreeAutocompleteVisible,
  subscribeFileTreeAutocompleteVisible,
} from './workspaceFileTreeAutocompleteVisible';
import {
  acquireFileTreeWatch,
  isFileTreeWatchActive,
  releaseFileTreeWatch,
  subscribeFileTreeWatch,
} from './workspaceFileTreeWatchCoordinator';

import { normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';
import type { Workspace } from '@/modules/chatroom/types/workspace';

export function useFileTreeWatchEnabled(machineId: string, workingDir: string): boolean {
  const normalized = normalizeWorkspaceWorkingDir(workingDir);
  return useSyncExternalStore(
    subscribeFileTreeWatch,
    () => isFileTreeWatchActive(machineId, normalized),
    () => false
  );
}

/**
 * Acquires a file-tree watch while `active` (explorer, file picker, @ autocomplete).
 */
export function useAcquireFileTreeWatch(
  machineId: string | null | undefined,
  workingDir: string | null | undefined,
  active: boolean
): void {
  const adjustWatch = useSessionMutation(api.workspaceFiles.adjustFileTreeWatch);

  useEffect(() => {
    if (!active || !machineId?.trim() || !workingDir?.trim()) return;

    acquireFileTreeWatch(machineId, workingDir, adjustWatch);
    return () => releaseFileTreeWatch(machineId, workingDir, adjustWatch);
  }, [active, machineId, workingDir, adjustWatch]);
}

/** Acquires watches for all linked workspaces while @ autocomplete is visible. */
export function useMultiWorkspaceFileTreeWatch(workspaces: Workspace[]): void {
  const active = useSyncExternalStore(
    subscribeFileTreeAutocompleteVisible,
    () => getFileTreeAutocompleteVisible(),
    () => false
  );
  const adjustWatch = useSessionMutation(api.workspaceFiles.adjustFileTreeWatch);
  const slotsKey = multiWorkspaceSlotsKey(workspaces);

  useEffect(() => {
    if (!active) return;

    const acquiredSlots = prepareMultiWorkspaceSlots(workspaces)
      .slice(0, MAX_MULTI_WORKSPACE_SLOTS)
      .filter((slot): slot is NonNullable<typeof slot> => slot !== null);

    for (const slot of acquiredSlots) {
      acquireFileTreeWatch(slot.machineId, slot.workingDir, adjustWatch);
    }

    return () => {
      for (const slot of acquiredSlots) {
        releaseFileTreeWatch(slot.machineId, slot.workingDir, adjustWatch);
      }
    };
  }, [active, slotsKey, workspaces, adjustWatch]);
}

// fallow-ignore-next-line complexity
function useWorkspaceFileTreeProducerSlot(
  slot: ReturnType<typeof prepareMultiWorkspaceSlots>[number]
): void {
  const watchEnabled = useFileTreeWatchEnabled(slot?.machineId ?? '', slot?.workingDir ?? '');
  useWorkspaceFileTree({
    machineId: slot?.machineId ?? '',
    workingDir: slot?.workingDir ?? '',
    enabled: !!slot && watchEnabled,
  });
}

/** Hydrates store + delta sync for watched workspaces while @ autocomplete is visible. */
// fallow-ignore-next-line complexity
export function useAutocompleteWorkspaceFileTreeSync(workspaces: Workspace[]): void {
  const autocompleteActive = useSyncExternalStore(
    subscribeFileTreeAutocompleteVisible,
    () => getFileTreeAutocompleteVisible(),
    () => false
  );
  const slotsKey = multiWorkspaceSlotsKey(workspaces);
  const slots = useMemo(() => prepareMultiWorkspaceSlots(workspaces), [slotsKey]);

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

  useWorkspaceFileTreeProducerSlot(autocompleteActive ? slot0 : null);
  useWorkspaceFileTreeProducerSlot(autocompleteActive ? slot1 : null);
  useWorkspaceFileTreeProducerSlot(autocompleteActive ? slot2 : null);
  useWorkspaceFileTreeProducerSlot(autocompleteActive ? slot3 : null);
  useWorkspaceFileTreeProducerSlot(autocompleteActive ? slot4 : null);
  useWorkspaceFileTreeProducerSlot(autocompleteActive ? slot5 : null);
  useWorkspaceFileTreeProducerSlot(autocompleteActive ? slot6 : null);
  useWorkspaceFileTreeProducerSlot(autocompleteActive ? slot7 : null);
  useWorkspaceFileTreeProducerSlot(autocompleteActive ? slot8 : null);
  useWorkspaceFileTreeProducerSlot(autocompleteActive ? slot9 : null);
}
