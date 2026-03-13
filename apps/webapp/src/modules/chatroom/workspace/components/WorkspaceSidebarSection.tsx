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

interface WorkspaceSidebarSectionProps {
  workspaces: Workspace[];
  chatroomId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getWorkspaceName(workingDir: string): string {
  return workingDir.split('/').filter(Boolean).pop() ?? workingDir;
}

// ─── WorkspaceRow ─────────────────────────────────────────────────────────────

const WorkspaceRow = memo(function WorkspaceRow({
  workspace,
  isActive,
  onClick,
}: {
  workspace: Workspace;
  isActive: boolean;
  onClick: () => void;
}) {
  const gitState = useWorkspaceGit(workspace.machineId!, workspace.workingDir);

  // Build stat content (same logic as WorkspaceChip)
  let statContent: React.ReactNode = null;
  if (gitState.status === 'loading') {
    statContent = <span className="text-chatroom-text-muted text-[10px]">…</span>;
  } else if (gitState.status === 'available') {
    const { insertions, deletions, filesChanged } = gitState.diffStat;
    const isClean = filesChanged === 0 && insertions === 0 && deletions === 0;
    if (isClean) {
      statContent = <span className="text-chatroom-text-muted text-[10px]">clean</span>;
    } else {
      statContent = (
        <span className="flex items-center gap-0.5 text-[10px]">
          <span className="text-chatroom-status-success">+{insertions}</span>
          <span className="text-chatroom-status-error">−{deletions}</span>
        </span>
      );
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left px-3 py-2 flex items-center gap-2 transition-colors',
        isActive
          ? 'bg-chatroom-bg-hover border-l-2 border-chatroom-accent'
          : 'border-l-2 border-transparent hover:bg-chatroom-bg-hover/50',
      )}
    >
      <FolderOpen
        size={12}
        className={cn(
          'shrink-0',
          isActive ? 'text-chatroom-text-primary' : 'text-chatroom-text-muted',
        )}
      />
      <div className="flex flex-col items-start min-w-0">
        <span
          className={cn(
            'text-[10px] font-bold uppercase tracking-wider truncate w-full',
            isActive ? 'text-chatroom-text-primary' : 'text-chatroom-text-secondary',
          )}
        >
          {getWorkspaceName(workspace.workingDir)}
        </span>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-[10px] text-chatroom-text-muted">{workspace.hostname}</span>
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

// ─── WorkspaceSidebarSection ──────────────────────────────────────────────────

/**
 * Sidebar section that lists workspaces and opens a full-screen modal
 * with the git panel when a workspace is selected.
 *
 * Also renders the Chatroom ID at the bottom.
 */
export const WorkspaceSidebarSection = memo(function WorkspaceSidebarSection({
  workspaces,
  chatroomId,
}: WorkspaceSidebarSectionProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleClick = useCallback((wsId: string) => {
    setSelectedId(wsId);
  }, []);

  const handleClose = useCallback(() => {
    setSelectedId(null);
  }, []);

  const selectedWorkspace = workspaces.find((w) => w.id === selectedId);

  if (workspaces.length === 0) return null;

  return (
    <>
      <div className="border-t-2 border-chatroom-border-strong">
        {/* Section header */}
        <div className="px-3 pt-3 pb-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
            Workspaces
          </span>
        </div>

        {/* Workspace list */}
        {workspaces.map((ws) => (
          <WorkspaceRow
            key={ws.id}
            workspace={ws}
            isActive={selectedId === ws.id}
            onClick={() => handleClick(ws.id)}
          />
        ))}

        {/* Chatroom ID */}
        <div className="px-3 py-3 border-t border-chatroom-border mt-2">
          <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted mb-1">
            Chatroom ID
          </div>
          <div className="font-mono text-[10px] font-bold text-chatroom-text-secondary break-all p-1.5 bg-chatroom-bg-tertiary">
            {chatroomId}
          </div>
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
                chatroomId={chatroomId}
              />
            )}
          </FixedModalBody>
        </FixedModalContent>
      </FixedModal>
    </>
  );
});
