'use client';

import { useMemo } from 'react';

import { useFileEntries } from './useFileEntries';
import type { FileEntry } from '../components/FileSelector/useFileSelector';
import type { Workspace } from '../types/workspace';
import { useFileTree } from '../workspace/hooks/useFileTree';

import { encodeWorkspaceId } from '@/lib/workspaceIdentifier';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum number of concurrent workspace file tree subscriptions.
 * React hooks cannot be called conditionally, so we allocate a fixed number
 * of slots and fill unused ones with 'skip'.
 */
const MAX_WORKSPACES = 10;

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkspaceSlot {
  machineId: string;
  workingDir: string;
  workspaceId: string;
}

// ─── Internals ────────────────────────────────────────────────────────────────

/**
 * Prepare a fixed-size array of workspace slots (length = MAX_WORKSPACES).
 * Each slot is either a valid WorkspaceSlot or null (→ 'skip' for useFileTree).
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

/** Convert a slot to useFileTree args. */
function slotToArgs(
  slot: WorkspaceSlot | null
): { machineId: string; workingDir: string } | 'skip' {
  return slot ? { machineId: slot.machineId, workingDir: slot.workingDir } : 'skip';
}

/** Tag parsed file entries with the workspace's encoded identifier. */
function tagEntries(entries: FileEntry[], workspaceId: string | undefined): FileEntry[] {
  if (!workspaceId || entries.length === 0) return entries;
  return entries.map((e) => ({ ...e, workspaceId }));
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Subscribe to file trees from multiple workspaces and merge their entries.
 *
 * Each file entry is tagged with `workspaceId` (base64url-encoded identifier)
 * so downstream consumers (e.g. file reference trigger) know which workspace
 * a file belongs to without needing a separate workspaceName prop.
 *
 * Uses a fixed-slot approach to satisfy React's rules of hooks: we always call
 * `useFileTree` exactly MAX_WORKSPACES times, using 'skip' for empty slots.
 */
export function useMultiWorkspaceFiles(workspaces: Workspace[]): FileEntry[] {
  // Memoize the slot computation to avoid unnecessary re-renders.
  //
  // Why JSON.stringify for the dependency?
  // Workspace objects don't have stable references across renders — the parent
  // may reconstruct the array each time. Comparing individual fields would mean
  // tracking each of the MAX_WORKSPACES slots separately in the dep array, adding
  // up to 20 deps. Instead we serialize the identity-significant fields
  // (machineId + workingDir) into a single string. The array is capped at 10
  // items so serialization cost is negligible.
   
  const slots = useMemo(
    () => prepareSlots(workspaces),
    [
      // eslint-disable-next-line react-hooks/exhaustive-deps
      JSON.stringify(
        workspaces.slice(0, MAX_WORKSPACES).map((w) => `${w.machineId}::${w.workingDir}`)
      ),
    ]
  );

  // ── Fixed hook calls (one per slot) ──────────────────────────────────────
  // IMPORTANT: These must be unconditional, fixed-count calls.
  const tree0 = useFileTree(slotToArgs(slots[0]!));
  const tree1 = useFileTree(slotToArgs(slots[1]!));
  const tree2 = useFileTree(slotToArgs(slots[2]!));
  const tree3 = useFileTree(slotToArgs(slots[3]!));
  const tree4 = useFileTree(slotToArgs(slots[4]!));
  const tree5 = useFileTree(slotToArgs(slots[5]!));
  const tree6 = useFileTree(slotToArgs(slots[6]!));
  const tree7 = useFileTree(slotToArgs(slots[7]!));
  const tree8 = useFileTree(slotToArgs(slots[8]!));
  const tree9 = useFileTree(slotToArgs(slots[9]!));

  const entries0 = useFileEntries(tree0);
  const entries1 = useFileEntries(tree1);
  const entries2 = useFileEntries(tree2);
  const entries3 = useFileEntries(tree3);
  const entries4 = useFileEntries(tree4);
  const entries5 = useFileEntries(tree5);
  const entries6 = useFileEntries(tree6);
  const entries7 = useFileEntries(tree7);
  const entries8 = useFileEntries(tree8);
  const entries9 = useFileEntries(tree9);

  // ── Merge & tag ──────────────────────────────────────────────────────────
  return useMemo(() => {
    const allEntries = [
      entries0,
      entries1,
      entries2,
      entries3,
      entries4,
      entries5,
      entries6,
      entries7,
      entries8,
      entries9,
    ];
    const merged: FileEntry[] = [];
    for (let i = 0; i < MAX_WORKSPACES; i++) {
      const tagged = tagEntries(allEntries[i]!, slots[i]?.workspaceId);
      if (tagged.length > 0) {
        merged.push(...tagged);
      }
    }
    return merged;
  }, [
    entries0,
    entries1,
    entries2,
    entries3,
    entries4,
    entries5,
    entries6,
    entries7,
    entries8,
    entries9,
    slots,
  ]);
}
