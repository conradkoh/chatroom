'use client';

import { FolderOpen, GitBranch, GitPullRequest as GitPullRequestIcon, Trash2 } from 'lucide-react';
import { memo, useState, useCallback } from 'react';

import { InlineDiffStat } from './shared';
import { WorkspaceGitPanel } from './WorkspaceGitPanel';
import type { Workspace } from '../../types/workspace';
import { useWorkspaceGit } from '../hooks/useWorkspaceGit';
import {
  FixedModal,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
  FixedModalBody,
} from '@/components/ui/fixed-modal';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkspaceSidebarSectionProps {
  workspaces: Workspace[];
  chatroomId: string;
  onRemoveWorkspace?: (registryId: string) => Promise<void>;
}

/**
 * A workspace that is guaranteed to have a machineId.
 * Used for components that require a valid machine connection.
 */
type WorkspaceWithMachine = Workspace & { machineId: string };

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
  workspace: WorkspaceWithMachine;
}) {
  const gitState = useWorkspaceGit(workspace.machineId, workspace.workingDir);

  const isAvailable = gitState.status === 'available';

  return (
    <div className="border-t-2 border-chatroom-border-strong bg-chatroom-bg-surface px-4 py-2 flex-shrink-0 flex items-center justify-end gap-2 flex-wrap">
      {/* Workspace name */}
      <div className="flex items-center gap-1">
        <FolderOpen size={11} className="text-chatroom-text-muted shrink-0" />
        <span className="text-[11px] text-chatroom-text-primary font-medium uppercase tracking-wider">
          {getWorkspaceName(workspace.workingDir)}
        </span>
      </div>

      {/* Hostname */}
      <span className="text-[11px] text-chatroom-text-muted">·</span>
      <span className="text-[11px] text-chatroom-text-muted uppercase tracking-wider">
        {workspace.hostname}
      </span>

      {/* Branch name (when available) — links to first PR if one exists */}
      {isAvailable && (
        <>
          <span className="text-[11px] text-chatroom-text-muted">·</span>
          {(gitState.openPullRequests?.length ?? 0) > 0 ? (
            <a
              href={gitState.openPullRequests[0]!.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-0.5 text-chatroom-status-info hover:text-chatroom-accent transition-colors"
              title={gitState.openPullRequests[0]!.title}
            >
              <GitPullRequestIcon size={10} className="shrink-0" />
              <span className="text-[11px] font-mono uppercase tracking-wider">
                {gitState.branch === 'HEAD' ? 'detached HEAD' : gitState.branch}
              </span>
              <span className="text-[11px] font-mono">
                (#{gitState.openPullRequests[0]!.number})
              </span>
            </a>
          ) : (
            <div className="flex items-center gap-0.5">
              <GitBranch size={10} className="text-chatroom-text-muted shrink-0" />
              <span className="text-[11px] font-mono text-chatroom-text-secondary uppercase tracking-wider">
                {gitState.branch === 'HEAD' ? 'detached HEAD' : gitState.branch}
              </span>
            </div>
          )}
        </>
      )}

      {/* Diff stats (when available) */}
      {isAvailable && (
        <>
          <span className="text-[11px] text-chatroom-text-muted">·</span>
          <InlineDiffStat diffStat={gitState.diffStat} showFileCount={false} />
        </>
      )}
    </div>
  );
});

// ─── WorkspaceRow ─────────────────────────────────────────────────────────────

const WorkspaceRow = memo(function WorkspaceRow({
  workspace,
  isActive,
  onClick,
  onRemove,
}: {
  workspace: WorkspaceWithMachine;
  isActive: boolean;
  onClick: () => void;
  onRemove?: () => void;
}) {
  const gitState = useWorkspaceGit(workspace.machineId, workspace.workingDir);

  // Build stat content
  let statContent: React.ReactNode = null;
  if (gitState.status === 'loading') {
    statContent = <span className="text-chatroom-text-muted text-[10px]">…</span>;
  } else if (gitState.status === 'available') {
    statContent = <InlineDiffStat diffStat={gitState.diffStat} showFileCount={false} />;
  }

  const branchName =
    gitState.status === 'available'
      ? gitState.branch === 'HEAD'
        ? 'detached'
        : gitState.branch
      : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group/wsrow w-full text-left px-3 py-2 flex items-center gap-2 transition-colors',
        isActive
          ? 'bg-chatroom-bg-hover border-l-2 border-chatroom-accent'
          : 'border-l-2 border-transparent hover:bg-chatroom-bg-hover/50'
      )}
    >
      <FolderOpen
        size={12}
        className={cn(
          'shrink-0',
          isActive ? 'text-chatroom-text-primary' : 'text-chatroom-text-muted'
        )}
      />
      <div className="flex flex-col items-start min-w-0 flex-1">
        <span
          className={cn(
            'text-[10px] font-bold uppercase tracking-wider truncate w-full',
            isActive ? 'text-chatroom-text-primary' : 'text-chatroom-text-secondary'
          )}
        >
          {getWorkspaceName(workspace.workingDir)}
        </span>
        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
          <span className="text-[10px] text-chatroom-text-muted">{workspace.hostname}</span>
          {statContent && (
            <>
              <span className="text-[10px] text-chatroom-text-muted">·</span>
              {statContent}
            </>
          )}
        </div>
        {branchName && (
          <div className="flex items-center gap-0.5 mt-0.5">
            {gitState.status === 'available' &&
            (gitState.openPullRequests?.length ?? 0) > 0 ? (
              <a
                href={gitState.openPullRequests[0]!.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-0.5 text-chatroom-status-info hover:text-chatroom-accent transition-colors"
                title={gitState.openPullRequests[0]!.title}
              >
                <GitPullRequestIcon size={9} className="shrink-0" />
                <span className="text-[10px] font-mono truncate max-w-[120px]">
                  {branchName}
                </span>
                <span className="text-[10px] font-mono">
                  (#{gitState.openPullRequests[0]!.number})
                </span>
              </a>
            ) : (
              <>
                <GitBranch size={10} className="text-chatroom-text-muted shrink-0" />
                <span className="text-[10px] font-mono text-chatroom-text-muted truncate max-w-[120px]">
                  {branchName}
                </span>
              </>
            )}
          </div>
        )}
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="shrink-0 p-1 opacity-0 group-hover/wsrow:opacity-100 transition-opacity text-chatroom-text-muted hover:text-red-500 dark:hover:text-red-400"
          title="Remove workspace"
        >
          <Trash2 size={12} />
        </button>
      )}
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
  onRemoveWorkspace,
}: WorkspaceSidebarSectionProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const handleClick = useCallback((wsId: string) => {
    setSelectedId(wsId);
  }, []);

  const handleClose = useCallback(() => {
    setSelectedId(null);
  }, []);

  const handleRemove = useCallback(
    async (workspace: Workspace) => {
      if (!workspace._registryId || !onRemoveWorkspace) return;
      if (!window.confirm('Remove this workspace from the list?')) return;
      await onRemoveWorkspace(workspace._registryId);
    },
    [onRemoveWorkspace]
  );

  const selectedWorkspace = workspaces.find((w) => w.id === selectedId);

  if (workspaces.length === 0) {
    return (
      <div className="border-t-2 border-chatroom-border-strong px-3 py-4">
        <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted mb-1">
          Workspaces
        </div>
        <div className="text-[11px] text-chatroom-text-muted mb-2">No workspaces available</div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted mb-1">
          Chatroom ID
        </div>
        <div
          className="font-mono text-[10px] font-bold text-chatroom-text-secondary break-all p-1.5 bg-chatroom-bg-tertiary cursor-pointer hover:bg-chatroom-bg-hover transition-colors"
          onClick={() => {
            navigator.clipboard.writeText(chatroomId);
          }}
          title="Click to copy"
        >
          {chatroomId}
        </div>
      </div>
    );
  }

  const primaryWorkspace = workspaces[0]!;
  const extraCount = workspaces.length - 1;
  const visibleWorkspaces = expanded ? workspaces : [primaryWorkspace];

  return (
    <>
      <div className="border-t-2 border-chatroom-border-strong">
        {/* Visible workspaces */}
        {visibleWorkspaces.map((ws) => (
          <WorkspaceRow
            key={ws.id}
            workspace={ws as WorkspaceWithMachine}
            isActive={selectedId === ws.id}
            onClick={() => handleClick(ws.id)}
            onRemove={
              onRemoveWorkspace && ws._registryId
                ? () => handleRemove(ws)
                : undefined
            }
          />
        ))}

        {/* Expand / collapse toggle */}
        {extraCount > 0 && (
          <div className="px-3 py-2">
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="text-[10px] text-chatroom-text-muted hover:text-chatroom-text-secondary transition-colors"
            >
              {expanded
                ? 'Show less'
                : `View ${extraCount} more workspace${extraCount > 1 ? 's' : ''}`}
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
            <WorkspaceInfoFooter workspace={selectedWorkspace as WorkspaceWithMachine} />
          )}
        </FixedModalContent>
      </FixedModal>
    </>
  );
});
