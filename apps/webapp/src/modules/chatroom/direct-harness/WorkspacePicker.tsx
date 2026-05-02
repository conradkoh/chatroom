'use client';

/**
 * WorkspacePicker — ShadCN Select to choose from registered workspaces.
 */

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface WorkspacePickerProps {
  chatroomId: string;
  selectedWorkspaceId: string | null;
  onSelect: (workspaceId: string) => void;
}

export function WorkspacePicker({
  chatroomId,
  selectedWorkspaceId,
  onSelect,
}: WorkspacePickerProps) {
  const workspaces = useSessionQuery(api.workspaces.listWorkspacesForChatroom, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });

  const allWorkspaces = workspaces ?? [];

  if (workspaces !== undefined && allWorkspaces.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No workspaces yet. Create one with{' '}
        <code className="text-xs bg-muted px-1 rounded">chatroom workspace create</code> (UI
        creation coming soon).
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground font-medium">Workspace</label>
      <Select value={selectedWorkspaceId ?? undefined} onValueChange={onSelect}>
        <SelectTrigger className="h-8 text-xs bg-card border-border text-foreground">
          <SelectValue placeholder="Select workspace…" />
        </SelectTrigger>
        <SelectContent className="bg-card border-border">
          {allWorkspaces.map((ws) => (
            <SelectItem
              key={ws._id}
              value={ws._id}
              className="text-xs text-foreground hover:bg-accent/50"
            >
              {ws.workingDir}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
