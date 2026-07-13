'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { WorkspaceForChatroomView } from '@workspace/backend/src/domain/usecase/workspace/list-workspaces-for-chatroom';
import { ChevronDown } from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import { selectTriggerClassName } from './ui/select';
import {
  ResponsivePickerShell,
  PickerSearch,
  PickerScrollBody,
  PickerOptionRow,
  usePickerSearchState,
  filterPickerItems,
} from '../../components/picker';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HarnessWorkspaceSwitcherProps {
  workspaces: WorkspaceForChatroomView[];
  selectedWorkspaceId: Id<'chatroom_workspaces'> | null;
  onSelect: (id: Id<'chatroom_workspaces'>) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}

function workspaceLabel(ws: WorkspaceForChatroomView): string {
  return `${ws.machineAlias ?? ws.hostname} — ${basename(ws.workingDir)}`;
}

// ─── HarnessWorkspaceSwitcher ────────────────────────────────────────────────────────

export const HarnessWorkspaceSwitcher = memo(function HarnessWorkspaceSwitcher({
  workspaces,
  selectedWorkspaceId,
  onSelect,
}: HarnessWorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const { searchTerm, setSearchTerm, handleOpenChange } = usePickerSearchState(setOpen);

  const selectedWorkspace = useMemo(
    () => workspaces.find((ws) => ws._id === selectedWorkspaceId),
    [workspaces, selectedWorkspaceId]
  );

  const filteredWorkspaces = filterPickerItems(
    workspaces,
    searchTerm,
    (ws) => `${workspaceLabel(ws)} ${ws.workingDir}`
  );

  if (workspaces.length === 0) {
    return (
      <div className="text-xs text-muted-foreground px-2 py-1.5">
        No workspaces in this chatroom
      </div>
    );
  }

  return (
    <ResponsivePickerShell
      open={open}
      onOpenChange={handleOpenChange}
      title="Select workspace"
      align="start"
      contentClassName="w-72"
      trigger={
        <button type="button" className={selectTriggerClassName} title="Select workspace">
          <span className="truncate text-left flex-1">
            {selectedWorkspace ? workspaceLabel(selectedWorkspace) : 'Select workspace…'}
          </span>
          <ChevronDown size={12} className="shrink-0 opacity-50" />
        </button>
      }
    >
      <PickerSearch value={searchTerm} onChange={setSearchTerm} placeholder="Search workspaces…" />
      <PickerScrollBody maxHeightClassName="max-h-60">
        {filteredWorkspaces.length === 0 ? (
          <p className="px-3 py-2 text-xs text-chatroom-text-muted">No workspaces found.</p>
        ) : (
          filteredWorkspaces.map((ws) => (
            <PickerOptionRow
              key={ws._id}
              selected={selectedWorkspaceId === ws._id}
              onSelect={() => {
                onSelect(ws._id);
                handleOpenChange(false);
              }}
            >
              {workspaceLabel(ws)}
            </PickerOptionRow>
          ))
        )}
      </PickerScrollBody>
    </ResponsivePickerShell>
  );
});
