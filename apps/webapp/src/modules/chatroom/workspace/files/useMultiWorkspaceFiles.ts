'use client';
// fallow-ignore-file complexity

import { useCallback, useEffect, useMemo } from 'react';

import { useWorkspaceFileListing } from './useWorkspaceFileListing';

import { encodeWorkspaceId } from '@/lib/workspaceIdentifier';
import type { FileEntry } from '@/modules/chatroom/components/FileSelector/useFileSelector';
import type { Workspace } from '@/modules/chatroom/types/workspace';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum number of concurrent workspace file listing subscriptions.
 * React hooks cannot be called conditionally, so we allocate a fixed number
 * of slots and fill unused ones with disabled useWorkspaceFileListing calls.
 */
const MAX_WORKSPACES = 10;

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkspaceSlot {
  machineId: string;
  workingDir: string;
  workspaceId: string;
}

interface UseMultiWorkspaceFilesResult {
  files: FileEntry[];
  refreshAll: () => void;
}

// ─── Internals ────────────────────────────────────────────────────────────────

/**
 * Prepare a fixed-size array of workspace slots (length = MAX_WORKSPACES).
 * Each slot is either a valid WorkspaceSlot or null (→ disabled useWorkspaceFileListing).
 */
function prepareSlots(workspaces: Workspace[]): (WorkspaceSlot | null)[] {
  const slots: (WorkspaceSlot | null)[] = [];
  for (let i = 0; i < MAX_WORKSPACES; i++) {
    const ws = workspaces[i];
    if (ws && ws.machineId && ws.workingDir) {
      slots.push({
        machineId: ws.machineId,
        workingDir: ws.workingDir,
        workspaceId: encodeWorkspaceId(ws.machineId, ws.workingDir),
      });
    } else {
      slots.push(null);
    }
  }
  return slots;
}

/** Convert a slot to useWorkspaceFileListing args. */
function slotToWorkspaceFileListingArgs(slot: WorkspaceSlot | null | undefined) {
  return {
    machineId: slot?.machineId ?? '',
    workingDir: slot?.workingDir ?? '',
    enabled: !!slot,
    includeDirectories: true,
  };
}

/** Tag parsed file entries with the workspace's encoded identifier. */
function tagEntries(entries: FileEntry[], workspaceId: string | undefined): FileEntry[] {
  if (!workspaceId || entries.length === 0) return entries;
  return entries.map((e) => ({ ...e, workspaceId }));
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Subscribe to file listings from multiple workspaces and merge their entries.
 *
 * Each file entry is tagged with `workspaceId` (base64url-encoded identifier)
 * so downstream consumers (e.g. file reference trigger) know which workspace
 * a file belongs to without needing a separate workspaceName prop.
 *
 * Uses a fixed-slot approach to satisfy React's rules of hooks: we always call
 * `useWorkspaceFileListing` exactly MAX_WORKSPACES times, disabling empty slots.
 */
export function useMultiWorkspaceFiles(workspaces: Workspace[]): UseMultiWorkspaceFilesResult {
  // Memoize the slot computation to avoid unnecessary re-renders.
  //
  // Why JSON.stringify for the dependency?
  // Workspace objects don't have stable references across renders — the parent
  // may reconstruct the array each time. Comparing individual fields would mean
  // tracking each of the MAX_WORKSPACES slots separately in the dep array, adding
  // up to 20 deps. Instead we serialize the identity-significant fields
  // (machineId + workingDir) into a single string. The array is capped at 10
  // items so serialization cost is negligible.
  const workspaceSlotsKey = JSON.stringify(
    workspaces.slice(0, MAX_WORKSPACES).map((w) => `${w.machineId}::${w.workingDir}`)
  );
  const slots = useMemo(() => prepareSlots(workspaces), [workspaceSlotsKey]);

  // ── Fixed hook calls (one per slot) ──────────────────────────────────────
  // IMPORTANT: These must be unconditional, fixed-count calls.
  const fileTree0 = useWorkspaceFileListing(slotToWorkspaceFileListingArgs(slots[0]));
  const fileTree1 = useWorkspaceFileListing(slotToWorkspaceFileListingArgs(slots[1]));
  const fileTree2 = useWorkspaceFileListing(slotToWorkspaceFileListingArgs(slots[2]));
  const fileTree3 = useWorkspaceFileListing(slotToWorkspaceFileListingArgs(slots[3]));
  const fileTree4 = useWorkspaceFileListing(slotToWorkspaceFileListingArgs(slots[4]));
  const fileTree5 = useWorkspaceFileListing(slotToWorkspaceFileListingArgs(slots[5]));
  const fileTree6 = useWorkspaceFileListing(slotToWorkspaceFileListingArgs(slots[6]));
  const fileTree7 = useWorkspaceFileListing(slotToWorkspaceFileListingArgs(slots[7]));
  const fileTree8 = useWorkspaceFileListing(slotToWorkspaceFileListingArgs(slots[8]));
  const fileTree9 = useWorkspaceFileListing(slotToWorkspaceFileListingArgs(slots[9]));

  const refreshAll = useCallback(() => {
    fileTree0.refresh();
    fileTree1.refresh();
    fileTree2.refresh();
    fileTree3.refresh();
    fileTree4.refresh();
    fileTree5.refresh();
    fileTree6.refresh();
    fileTree7.refresh();
    fileTree8.refresh();
    fileTree9.refresh();
  }, [
    fileTree0.refresh,
    fileTree1.refresh,
    fileTree2.refresh,
    fileTree3.refresh,
    fileTree4.refresh,
    fileTree5.refresh,
    fileTree6.refresh,
    fileTree7.refresh,
    fileTree8.refresh,
    fileTree9.refresh,
  ]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // ── Merge & tag ──────────────────────────────────────────────────────────
  const files = useMemo(() => {
    const allEntries = [
      fileTree0.entries,
      fileTree1.entries,
      fileTree2.entries,
      fileTree3.entries,
      fileTree4.entries,
      fileTree5.entries,
      fileTree6.entries,
      fileTree7.entries,
      fileTree8.entries,
      fileTree9.entries,
    ];
    const merged: FileEntry[] = [];
    for (let i = 0; i < MAX_WORKSPACES; i++) {
      const tagged = tagEntries(allEntries[i] ?? [], slots[i]?.workspaceId);
      if (tagged.length > 0) {
        merged.push(...tagged);
      }
    }
    return merged;
  }, [
    fileTree0.entries,
    fileTree1.entries,
    fileTree2.entries,
    fileTree3.entries,
    fileTree4.entries,
    fileTree5.entries,
    fileTree6.entries,
    fileTree7.entries,
    fileTree8.entries,
    fileTree9.entries,
    slots,
  ]);

  return useMemo(() => ({ files, refreshAll }), [files, refreshAll]);
}
