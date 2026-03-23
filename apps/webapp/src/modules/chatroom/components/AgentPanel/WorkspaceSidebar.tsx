'use client';

import { FolderOpen } from 'lucide-react';
import { memo } from 'react';

import type { WorkspaceGroup } from '../../types/workspace';

interface WorkspaceSidebarProps {
  workspaceGroups: WorkspaceGroup[];
  selectedWorkspaceId: string | null;
  onSelectWorkspace: (id: string) => void;
}

/** Left sidebar of the All Agents modal — lists workspaces grouped by machine. */
export const WorkspaceSidebar = memo(function WorkspaceSidebar({
  workspaceGroups,
  selectedWorkspaceId,
  onSelectWorkspace,
}: WorkspaceSidebarProps) {
  if (workspaceGroups.length === 0) {
    return (
      <div className="hidden sm:block w-48 flex-shrink-0 border-r-2 border-chatroom-border overflow-y-auto p-3">
        <p className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted">
          No workspaces
        </p>
      </div>
    );
  }

  return (
    <div className="hidden sm:block w-48 flex-shrink-0 border-r-2 border-chatroom-border overflow-y-auto">
      {/* Sidebar header */}
      <div className="px-3 pt-3 pb-2 border-b border-chatroom-border">
        <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
          Workspaces
        </span>
      </div>

      {workspaceGroups.map((group, index) => (
        <div key={group.machineId ?? `__unassigned_${index}`}>
          {/* Machine label */}
          <div className="px-3 pt-3 pb-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
              {group.hostname}
            </span>
          </div>
          {/* Workspaces under this machine */}
          {group.workspaces.map((ws) => {
            const isSelected = ws.id === selectedWorkspaceId;
            // Show just the last path segment as a short label, full path as title
            const dirLabel = ws.workingDir
              ? (ws.workingDir.split('/').filter(Boolean).pop() ?? ws.workingDir)
              : '(no directory)';

            return (
              <button
                key={ws.id}
                type="button"
                title={ws.workingDir || 'Unassigned agents'}
                onClick={() => onSelectWorkspace(ws.id)}
                className={`w-full text-left px-3 py-2 flex items-center gap-1.5 transition-colors ${
                  isSelected
                    ? 'bg-chatroom-bg-hover border-l-2 border-chatroom-accent'
                    : 'border-l-2 border-transparent hover:bg-chatroom-bg-hover/50'
                }`}
              >
                <FolderOpen
                  size={12}
                  className={`flex-shrink-0 ${isSelected ? 'text-chatroom-text-primary' : 'text-chatroom-text-muted'}`}
                />
                <span
                  className={`text-[11px] font-medium truncate ${
                    isSelected ? 'text-chatroom-text-primary' : 'text-chatroom-text-secondary'
                  }`}
                >
                  {dirLabel}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
});
