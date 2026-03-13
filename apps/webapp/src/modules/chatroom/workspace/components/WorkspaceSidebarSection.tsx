'use client';

import { memo, useState, useCallback } from 'react';
import { FolderOpen, GitBranch } from 'lucide-react';
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

// ─── WorkspaceInfoFooter ──────────────────────────────────────────────────────

/**
 * Footer bar for the workspace git modal.
 * Shows workspace name, hostname, git branch, and diff stats.
 */
export const WorkspaceInfoFooter = memo(function WorkspaceInfoFooter({
  workspace,
}: {
  workspace: Workspace;
}) {
  const gitState = useWorkspaceGit(workspace.machineId!, workspace.workingDir);

  const isAvailable = gitState.status === 'available';

  return (
    <div className="border-t-2 border-chatroom-border-strong bg-chatroom-bg-surface px-4 py-2 flex-shrink-0 flex items-center gap-2 flex-wrap">
      {/* Workspace name */}
      <div className="flex items-center gap-1">
        <FolderOpen size={11} className="text-chatroom-text-muted shrink-0" />
        <span className="text-[11px] text-chatroom-text-primary font-medium">
          {getWorkspaceName(workspace.workingDir)}
        </span>
      </div>

      {/* Hostname */}
      <span className="text-[11px] text-chatroom-text-muted">·</span>
      <span className="text-[11px] text-chatroom-text-muted">{workspace.hostname}</span>

      {/* Branch name (when available) */}
      {isAvailable && (
        <>
          <span className="text-[11px] text-chatroom-text-muted">·</span>
          <div className="flex items-center gap-0.5">
            <GitBranch size={10} className="text-chatroom-text-muted shrink-0" />
            <span className="text-[11px] font-mono text-chatroom-text-secondary truncate max-w-[120px]">
              {gitState.branch}
            </span>
          </div>
        </>
      )}

      {/* Diff stats (when available) */}
      {isAvailable && (() => {
        const { insertions, deletions, filesChanged } = gitState.diffStat;
        const isClean = filesChanged === 0 && insertions === 0 && deletions === 0;
        return (
          <>
            <span className="text-[11px] text-chatroom-text-muted">·</span>
            {isClean ? (
              <span className="text-[11px] text-chatroom-text-muted">clean</span>
            ) : (
              <span className="flex items-center gap-0.5 text-[11px]">
                <span className="text-chatroom-status-success">+{insertions}</span>
                <span className="text-chatroom-status-error">−{deletions}</span>
              </span>
            )}
          </>
        );
      })()}
    </div>
  );
});

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

  // Build stat content
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

  const branchName = gitState.status === 'available' ? gitState.branch : null;

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
        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
          <span className="text-[10px] text-chatroom-text-muted">{workspace.hostname}</span>
          {branchName && (
            <>
              <span className="text-[10px] text-chatroom-text-muted">·</span>
              <span className="flex items-center gap-0.5">
                <GitBranch size={10} className="text-chatroom-text-muted shrink-0" />
                <span className="text-[10px] font-mono text-chatroom-text-muted truncate max-w-[80px]">
                  {branchName}
                </span>
              </span>
            </>
          )}
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
 * Sidebar section that lists the primary workspace and opens a full-screen modal
 * with the git panel when a workspace is selected.
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

  const primaryWorkspace = workspaces[0]!;
  const extraCount = workspaces.length - 1;

  return (
    <>
      <div className="border-t-2 border-chatroom-border-strong">
        {/* Primary workspace */}
        <WorkspaceRow
          key={primaryWorkspace.id}
          workspace={primaryWorkspace}
          isActive={selectedId === primaryWorkspace.id}
          onClick={() => handleClick(primaryWorkspace.id)}
        />

        {/* "View X more" indicator */}
        {extraCount > 0 && (
          <div className="px-3 py-2">
            <button
              type="button"
              className="text-[10px] text-chatroom-text-muted hover:text-chatroom-text-secondary transition-colors"
            >
              View {extraCount} more workspace{extraCount > 1 ? 's' : ''}
            </button>
          </div>
        )}
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
          {selectedWorkspace && selectedWorkspace.machineId && (
            <WorkspaceInfoFooter workspace={selectedWorkspace} />
          )}
        </FixedModalContent>
      </FixedModal>
    </>
  );
});
