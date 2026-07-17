import { encodeWorkspaceId, normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';
import type { FileEntry } from '@/modules/chatroom/components/FileSelector/useFileSelector';
import type { Workspace } from '@/modules/chatroom/types/workspace';

export const MAX_MULTI_WORKSPACE_SLOTS = 10;

export interface MultiWorkspaceSlot {
  machineId: string;
  workingDir: string;
  workspaceId: string;
}

// fallow-ignore-next-line complexity
export function prepareMultiWorkspaceSlots(workspaces: Workspace[]): (MultiWorkspaceSlot | null)[] {
  const slots: (MultiWorkspaceSlot | null)[] = [];
  for (let i = 0; i < MAX_MULTI_WORKSPACE_SLOTS; i++) {
    const ws = workspaces[i];
    if (ws?.machineId && ws.workingDir) {
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

export function multiWorkspaceSlotsKey(workspaces: Workspace[]): string {
  return JSON.stringify(
    workspaces.slice(0, MAX_MULTI_WORKSPACE_SLOTS).map((w) => `${w.machineId}::${w.workingDir}`)
  );
}

export function tagFileEntriesWithWorkspaceId(
  entries: FileEntry[],
  workspaceId: string | undefined
): FileEntry[] {
  if (!workspaceId || entries.length === 0) return entries;
  return entries.map((e) => ({ ...e, workspaceId }));
}
