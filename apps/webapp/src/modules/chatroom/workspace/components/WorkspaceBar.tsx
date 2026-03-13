'use client';

import { memo, useState, useCallback } from 'react';
import { FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Workspace } from '../../types/workspace';
import { useWorkspaceGit } from '../hooks/useWorkspaceGit';
import { WorkspaceGitPanel } from './WorkspaceGitPanel';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkspaceBarProps {
  workspaces: Workspace[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the last path component: "/Users/alice/chatroom" → "chatroom" */
function getWorkspaceName(workingDir: string): string {
  return workingDir.split('/').filter(Boolean).pop() ?? workingDir;
}

// ─── WorkspaceChip ────────────────────────────────────────────────────────────

interface WorkspaceChipProps {
  workspace: Workspace;
  isActive: boolean;
  onClick: () => void;
}

const WorkspaceChip = memo(function WorkspaceChip({
  workspace,
  isActive,
  onClick,
}: WorkspaceChipProps) {
  // machineId is guaranteed non-null by WorkspaceBar filter
  const gitState = useWorkspaceGit(workspace.machineId!, workspace.workingDir);

  // Diff stat display
  let statContent: React.ReactNode = null;
  if (gitState.status === 'loading') {
    statContent = <span className="text-chatroom-text-muted text-xs">…</span>;
  } else if (gitState.status === 'available') {
    const { insertions, deletions, filesChanged } = gitState.diffStat;
    const isClean = filesChanged === 0 && insertions === 0 && deletions === 0;
    if (isClean) {
      statContent = <span className="text-chatroom-text-muted text-xs">clean</span>;
    } else {
      statContent = (
        <span className="flex items-center gap-0.5 text-xs">
          <span className="text-chatroom-status-success">+{insertions}</span>
          <span className="text-chatroom-status-error">−{deletions}</span>
        </span>
      );
    }
  }
  // not_found / error → no stat shown

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors shrink-0 whitespace-nowrap',
        'hover:bg-chatroom-bg-hover',
        isActive && 'bg-chatroom-bg-hover border-b-2 border-chatroom-accent',
        !isActive && 'border-b-2 border-transparent',
      )}
    >
      <FolderOpen size={12} className="text-chatroom-text-muted shrink-0" />
      <span className="text-xs text-chatroom-text-primary font-medium">
        {getWorkspaceName(workspace.workingDir)}
      </span>
      <span className="text-xs text-chatroom-text-muted">·</span>
      <span className="text-xs text-chatroom-text-muted">{workspace.hostname}</span>
      {statContent && (
        <>
          <span className="text-xs text-chatroom-text-muted">·</span>
          {statContent}
        </>
      )}
    </button>
  );
});

// ─── WorkspaceBar ─────────────────────────────────────────────────────────────

/**
 * Dense inline bar displaying all workspaces above the message input.
 *
 * Clicking a chip expands a git panel below the chips; clicking again collapses it.
 */
export const WorkspaceBar = memo(function WorkspaceBar({ workspaces }: WorkspaceBarProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleClick = useCallback((wsId: string) => {
    setSelectedId((prev) => (prev === wsId ? null : wsId));
  }, []);

  const selectedWorkspace = workspaces.find((w) => w.id === selectedId);

  return (
    <div className="border-t border-chatroom-border bg-chatroom-bg-surface">
      {/* Workspace chips row */}
      <div className="flex items-center gap-1 px-4 py-1.5 overflow-x-auto">
        {workspaces.map((ws) => (
          <WorkspaceChip
            key={ws.id}
            workspace={ws}
            isActive={selectedId === ws.id}
            onClick={() => handleClick(ws.id)}
          />
        ))}
      </div>

      {/* Expanded git panel */}
      {selectedWorkspace && selectedWorkspace.machineId && (
        <div className="border-t border-chatroom-border px-4 py-3 max-h-[300px] overflow-y-auto">
          <WorkspaceGitPanel
            machineId={selectedWorkspace.machineId}
            workingDir={selectedWorkspace.workingDir}
          />
        </div>
      )}
    </div>
  );
});
