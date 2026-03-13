'use client';

import { memo, useState, useCallback } from 'react';
import { FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  FixedModal,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
  FixedModalBody,
} from '@/components/ui/fixed-modal';
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
    statContent = <span className="text-chatroom-text-muted text-[9px]">…</span>;
  } else if (gitState.status === 'available') {
    const { insertions, deletions, filesChanged } = gitState.diffStat;
    const isClean = filesChanged === 0 && insertions === 0 && deletions === 0;
    if (isClean) {
      statContent = <span className="text-chatroom-text-muted text-[9px]">clean</span>;
    } else {
      statContent = (
        <span className="flex items-center gap-0.5 text-[9px]">
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
        'flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors shrink-0',
        'hover:bg-chatroom-bg-hover',
        isActive && 'bg-chatroom-bg-hover border-b-2 border-chatroom-accent',
        !isActive && 'border-b-2 border-transparent',
      )}
    >
      <FolderOpen size={14} className="text-chatroom-text-muted shrink-0" />
      <div className="flex flex-col items-start">
        {/* Row 1: Workspace name (most attention) */}
        <span className="text-xs font-semibold text-chatroom-text-primary leading-tight">
          {getWorkspaceName(workspace.workingDir)}
        </span>

        {/* Row 2: Machine name + diff stats */}
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[10px] text-chatroom-text-muted">
            {workspace.hostname}
          </span>
          {statContent && (
            <>
              <span className="text-[10px] text-chatroom-text-muted">·</span>
              {statContent}
            </>
          )}
        </div>
      </div>
    </button>
  );
});

// ─── WorkspaceBar ─────────────────────────────────────────────────────────────

/**
 * Dense inline bar displaying all workspaces above the message input.
 *
 * Clicking a chip opens a near-full-screen modal with the full git panel.
 */
export const WorkspaceBar = memo(function WorkspaceBar({ workspaces }: WorkspaceBarProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleClick = useCallback((wsId: string) => {
    setSelectedId(wsId);
  }, []);

  const handleClose = useCallback(() => {
    setSelectedId(null);
  }, []);

  const selectedWorkspace = workspaces.find((w) => w.id === selectedId);

  return (
    <>
      <div className="border-t border-chatroom-border bg-chatroom-bg-surface">
        {/* Workspace chips row */}
        <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto">
          {workspaces.map((ws) => (
            <WorkspaceChip
              key={ws.id}
              workspace={ws}
              isActive={selectedId === ws.id}
              onClick={() => handleClick(ws.id)}
            />
          ))}
        </div>
      </div>

      {/* Workspace Git Modal */}
      <FixedModal
        isOpen={selectedId !== null}
        onClose={handleClose}
        maxWidth="max-w-[96vw]"
        className="sm:!h-[92vh]"
      >
        <FixedModalContent>
          <FixedModalHeader onClose={handleClose}>
            <FixedModalTitle>
              <div className="flex items-center gap-2">
                <FolderOpen size={16} className="text-chatroom-text-muted" />
                <span className="text-xs font-bold uppercase tracking-wider text-chatroom-text-primary">
                  {selectedWorkspace ? getWorkspaceName(selectedWorkspace.workingDir) : ''}
                </span>
                {selectedWorkspace && (
                  <span className="text-[11px] text-chatroom-text-muted">
                    {selectedWorkspace.hostname}
                  </span>
                )}
              </div>
            </FixedModalTitle>
          </FixedModalHeader>
          <FixedModalBody className="p-0 overflow-hidden">
            {selectedWorkspace && selectedWorkspace.machineId && (
              <WorkspaceGitPanel
                machineId={selectedWorkspace.machineId}
                workingDir={selectedWorkspace.workingDir}
              />
            )}
          </FixedModalBody>
        </FixedModalContent>
      </FixedModal>
    </>
  );
});
