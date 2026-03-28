'use client';

import { ChevronDown, ExternalLink, FolderOpen, GitBranch, GitPullRequest as GitPullRequestIcon, Trash2 } from 'lucide-react';
import type { ComponentType } from 'react';
import { memo, useState, useCallback, useMemo } from 'react';
import { SiGithub, SiGitlab, SiBitbucket } from 'react-icons/si';

import { InlineDiffStat } from './shared';
import { WorkspaceGitPanel } from './WorkspaceGitPanel';
import type { Workspace } from '../../types/workspace';
import { getWorkspaceDisplayHostname } from '../../types/workspace';
import { useWorkspaceGit } from '../hooks/useWorkspaceGit';
import type { GitRemote } from '../types/git';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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

/**
 * Converts a git remote URL to an HTTPS URL suitable for opening in a browser.
 * Handles SSH URLs (git@github.com:user/repo.git) and HTTPS URLs.
 * Returns null if the URL cannot be converted.
 */
function toHttpsUrl(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim().replace(/\.git$/, '');

  // Already HTTPS
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed;
  }

  // SSH format: git@github.com:user/repo
  const sshMatch = trimmed.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) {
    const [, host, path] = sshMatch;
    return `https://${host}/${path}`;
  }

  // ssh:// format: ssh://git@github.com/user/repo
  const sshProtoMatch = trimmed.match(/^ssh:\/\/[^@]+@([^/]+)\/(.+)$/);
  if (sshProtoMatch) {
    const [, host, path] = sshProtoMatch;
    return `https://${host}/${path}`;
  }

  return null;
}

/** Known git hosting platforms for icon matching. */
type GitPlatform = 'github' | 'gitlab' | 'bitbucket' | 'generic';

/** Detects the git hosting platform from a remote URL. */
function detectPlatform(remoteUrl: string): GitPlatform {
  const lower = remoteUrl.toLowerCase();
  if (lower.includes('github.com')) return 'github';
  if (lower.includes('gitlab.com') || lower.includes('gitlab')) return 'gitlab';
  if (lower.includes('bitbucket.org') || lower.includes('bitbucket')) return 'bitbucket';
  return 'generic';
}

/** Platform icon components keyed by platform type. */
const PLATFORM_ICONS: Record<GitPlatform, ComponentType<{ size?: number; className?: string }>> = {
  github: SiGithub,
  gitlab: SiGitlab,
  bitbucket: SiBitbucket,
  generic: ExternalLink,
};

/** Returns the appropriate icon component for a remote URL. */
function getPlatformIcon(remoteUrl: string): ComponentType<{ size?: number; className?: string }> {
  return PLATFORM_ICONS[detectPlatform(remoteUrl)];
}

// ─── RemoteRepoLink ───────────────────────────────────────────────────────────

/**
 * Renders a repository link with platform-specific icon and optional
 * dropdown for selecting among multiple remotes.
 * Defaults to "origin" if available, otherwise the first remote.
 */
const RemoteRepoLink = memo(function RemoteRepoLink({ remotes }: { remotes: GitRemote[] }) {
  if (remotes.length === 0) return null;

  const defaultRemote = useMemo(
    () => remotes.find((r) => r.name === 'origin') ?? remotes[0]!,
    [remotes]
  );
  const [selected, setSelected] = useState<GitRemote>(defaultRemote);
  const httpsUrl = toHttpsUrl(selected.url);
  const PlatformIcon = getPlatformIcon(selected.url);

  const linkContent = (
    <>
      {httpsUrl ? (
        <a
          href={httpsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-chatroom-status-info hover:text-chatroom-accent transition-colors font-mono"
          title={selected.url}
        >
          <PlatformIcon size={10} className="shrink-0" />
          {selected.name}
        </a>
      ) : (
        <span className="inline-flex items-center gap-1 text-[11px] text-chatroom-text-muted font-mono" title={selected.url}>
          <PlatformIcon size={10} className="shrink-0" />
          {selected.name}
        </span>
      )}
    </>
  );

  // Single remote — simple link, no dropdown
  if (remotes.length === 1) {
    return linkContent;
  }

  // Multiple remotes — link + dropdown chevron
  return (
    <span className="inline-flex items-center gap-0">
      {linkContent}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center p-0.5 text-chatroom-text-muted hover:text-chatroom-text-secondary transition-colors rounded"
            title="Select remote"
          >
            <ChevronDown size={10} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[120px]">
          {remotes.map((remote) => {
            const RemoteIcon = getPlatformIcon(remote.url);
            return (
              <DropdownMenuItem
                key={remote.name}
                onClick={() => setSelected(remote)}
                className={cn(
                  'text-[11px] font-mono flex items-center gap-1.5 cursor-pointer',
                  remote.name === selected.name && 'font-bold'
                )}
              >
                <RemoteIcon size={10} className="shrink-0 text-chatroom-status-info" />
                {remote.name}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
});

// ─── WorkspaceInfoFooter ──────────────────────────────────────────────────────

/**
 * Footer bar for the workspace git modal.
 * Split into two logical groups:
 *   1. Machine & git status: workspace name, hostname, branch, diff stats
 *   2. Remote-centric links: PR link, repo link with platform icon + remote selector
 */
export const WorkspaceInfoFooter = memo(function WorkspaceInfoFooter({
  workspace,
}: {
  workspace: WorkspaceWithMachine;
}) {
  const gitState = useWorkspaceGit(workspace.machineId, workspace.workingDir);

  const isAvailable = gitState.status === 'available';

  return (
    <div className="border-t-2 border-chatroom-border-strong bg-chatroom-bg-surface px-4 py-2 flex-shrink-0 flex items-center justify-between gap-3 flex-wrap">
      {/* ── Group 1: Machine & Git Status ── */}
      <div className="flex items-center gap-2 flex-wrap min-w-0">
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
          {getWorkspaceDisplayHostname(workspace)}
        </span>

        {/* Diff stats (when available) */}
        {isAvailable && (
          <>
            <span className="text-[11px] text-chatroom-text-muted">·</span>
            <InlineDiffStat diffStat={gitState.diffStat} showFileCount={false} />
          </>
        )}
      </div>

      {/* ── Group 2: Remote-centric Links ── */}
      {isAvailable && (
        <div className="flex items-center gap-2 flex-wrap">
          {/* Branch name — clickable with PR number when PR exists */}
          {(gitState.openPullRequests?.length ?? 0) > 0 ? (
            <a
              href={gitState.openPullRequests[0]!.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-[11px] text-chatroom-status-info hover:text-chatroom-accent transition-colors font-mono"
              title={gitState.openPullRequests[0]!.title}
            >
              <GitPullRequestIcon size={10} className="shrink-0" />
              <span className="uppercase tracking-wider">
                {gitState.branch === 'HEAD' ? 'detached HEAD' : gitState.branch}
              </span>
              <span>(#{gitState.openPullRequests[0]!.number})</span>
            </a>
          ) : (
            <div className="inline-flex items-center gap-0.5 text-[11px] font-mono">
              <GitBranch size={10} className="text-chatroom-text-muted shrink-0" />
              <span className="text-chatroom-text-secondary uppercase tracking-wider">
                {gitState.branch === 'HEAD' ? 'detached HEAD' : gitState.branch}
              </span>
            </div>
          )}

          {/* Repo link with platform icon + remote dropdown */}
          {gitState.remotes.length > 0 && (
            <>
              <span className="text-[11px] text-chatroom-text-muted">·</span>
              <RemoteRepoLink remotes={gitState.remotes} />
            </>
          )}
        </div>
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
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        'group/wsrow w-full text-left px-3 py-2 flex items-center gap-2 transition-colors cursor-pointer',
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
          <span className="text-[10px] text-chatroom-text-muted">{getWorkspaceDisplayHostname(workspace)}</span>
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
    </div>
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
                    {getWorkspaceDisplayHostname(selectedWorkspace)}
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
