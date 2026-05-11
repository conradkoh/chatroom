'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { WorkspaceForChatroomView } from '@workspace/backend/src/domain/usecase/workspace/list-workspaces-for-chatroom';
import { memo } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

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
  if (workspaces.length === 0) {
    return (
      <div className="text-xs text-muted-foreground px-2 py-1.5">
        No workspaces in this chatroom
      </div>
    );
  }

  return (
    <Select
      value={selectedWorkspaceId ?? undefined}
      onValueChange={(val) => onSelect(val as Id<'chatroom_workspaces'>)}
    >
      <SelectTrigger size="sm" className="w-full text-xs">
        <SelectValue placeholder="Select workspace…" />
      </SelectTrigger>
      <SelectContent>
        {workspaces.map((ws) => (
          <SelectItem key={ws._id} value={ws._id} title={ws.workingDir}>
            {workspaceLabel(ws)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
});
