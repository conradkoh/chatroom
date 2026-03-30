/**
 * Workspace Bottom Bar
 *
 * VS Code-style status bar at the bottom of the chatroom that displays
 * workspace information horizontally. Replaces the sidebar workspace section
 * to make better use of available screen width.
 *
 * Features:
 * - Workspace name + hostname (left)
 * - Git branch, PR link, diff stats, remote link (center)
 * - Local action buttons when isLocal (right): Finder, VS Code, GitHub Desktop
 * - Multi-workspace dropdown switcher (persisted in localStorage)
 * - Click workspace name → full-screen git modal
 * - Right-click workspace name → context menu with local actions
 */

'use client';

import {
  ChevronDown,
  Code2,
  ExternalLink,
  FolderOpen,
  GitBranch,
  GitPullRequest as GitPullRequestIcon,
  Trash2,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { memo, useState, useCallback, useMemo, useEffect } from 'react';
import { SiGithub, SiGitlab, SiBitbucket } from 'react-icons/si';

import { InlineDiffStat } from './shared';
import { WorkspaceGitPanel } from './WorkspaceGitPanel';
import type { Workspace } from '../../types/workspace';
import { getWorkspaceDisplayHostname } from '../../types/workspace';
import { useWorkspaceGit } from '../hooks/useWorkspaceGit';
import type { GitRemote } from '../types/git';
import { useLocalDaemon } from '@/hooks/useLocalDaemon';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
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

interface WorkspaceBottomBarProps {
  workspaces: Workspace[];
  chatroomId: string;
  onRemoveWorkspace?: (registryId: string) => Promise<void>;
}

/** A workspace guaranteed to have a machineId. */
type WorkspaceWithMachine = Workspace & { machineId: string };

// ─── Constants ────────────────────────────────────────────────────────────────

/** localStorage key prefix for persisting active workspace selection. */
const ACTIVE_WS_KEY_PREFIX = 'chatroom-active-workspace-';

/** Port the local daemon API listens on (must match daemon LOCAL_API_PORT). */
const LOCAL_API_PORT = 19847;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getWorkspaceName(workingDir: string): string {
  return workingDir.split('/').filter(Boolean).pop() ?? workingDir;
}

/**
 * Converts a git remote URL to an HTTPS URL suitable for opening in a browser.
 */
function toHttpsUrl(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim().replace(/\.git$/, '');
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) return trimmed;
  const sshMatch = trimmed.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) {
    const [, host, path] = sshMatch;
    return `https://${host}/${path}`;
  }
  const sshProtoMatch = trimmed.match(/^ssh:\/\/[^@]+@([^/]+)\/(.+)$/);
  if (sshProtoMatch) {
    const [, host, path] = sshProtoMatch;
    return `https://${host}/${path}`;
  }
  return null;
}

type GitPlatform = 'github' | 'gitlab' | 'bitbucket' | 'generic';

function detectPlatform(remoteUrl: string): GitPlatform {
  const httpsUrl = toHttpsUrl(remoteUrl);
  const hostname = httpsUrl
    ? (() => {
        try {
          return new URL(httpsUrl).hostname.toLowerCase();
        } catch {
          return '';
        }
      })()
    : '';
  if (hostname.includes('github.com')) return 'github';
  if (hostname.includes('gitlab.com') || hostname.includes('gitlab')) return 'gitlab';
  if (hostname.includes('bitbucket.org') || hostname.includes('bitbucket')) return 'bitbucket';
  return 'generic';
}

const PLATFORM_ICONS: Record<GitPlatform, ComponentType<{ size?: number; className?: string }>> = {
  github: SiGithub,
  gitlab: SiGitlab,
  bitbucket: SiBitbucket,
  generic: ExternalLink,
};

function getPlatformIcon(remoteUrl: string): ComponentType<{ size?: number; className?: string }> {
  return PLATFORM_ICONS[detectPlatform(remoteUrl)];
}

/**
 * Call a local daemon API endpoint with a workingDir payload.
 * Silent fail if daemon is not running or the request errors.
 */
async function callLocalApi(endpoint: string, workingDir: string): Promise<void> {
  try {
    const res = await fetch(`http://localhost:${LOCAL_API_PORT}/api/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workingDir }),
    });
    const data = (await res.json()) as { success: boolean; error?: string };
    if (!data.success) {
      console.warn(`[LocalAPI] ${endpoint}: ${data.error}`);
    }
  } catch {
    // Silent fail — daemon may not be running
  }
}

// ─── Active Workspace Persistence ─────────────────────────────────────────────

function getPersistedActiveWorkspaceId(chatroomId: string): string | null {
  try {
    return localStorage.getItem(`${ACTIVE_WS_KEY_PREFIX}${chatroomId}`);
  } catch {
    return null;
  }
}

function setPersistedActiveWorkspaceId(chatroomId: string, workspaceId: string): void {
  try {
    localStorage.setItem(`${ACTIVE_WS_KEY_PREFIX}${chatroomId}`, workspaceId);
  } catch {
    // Silent fail — localStorage may not be available
  }
}

// ─── WorkspaceStatusContent ───────────────────────────────────────────────────

/**
 * Inner content of the bottom bar that shows git state for the active workspace.
 * Separated so it can subscribe to workspace-specific hooks.
 */
const WorkspaceStatusContent = memo(function WorkspaceStatusContent({
  workspace,
  onOpenGitPanel,
}: {
  workspace: WorkspaceWithMachine;
  onOpenGitPanel: () => void;
}) {
  const gitState = useWorkspaceGit(workspace.machineId, workspace.workingDir);
  const { isLocal } = useLocalDaemon();

  const isAvailable = gitState.status === 'available';

  // Determine the primary remote for repo link
  const primaryRemote = isAvailable
    ? (gitState.remotes.find((r: GitRemote) => r.name === 'origin') ?? gitState.remotes[0])
    : undefined;
  const remoteHttpsUrl = primaryRemote ? toHttpsUrl(primaryRemote.url) : null;
  const PlatformIcon = primaryRemote ? getPlatformIcon(primaryRemote.url) : null;

  const workspaceNameEl = (
    <button
      type="button"
      onClick={onOpenGitPanel}
      className="flex items-center gap-1.5 hover:bg-chatroom-bg-hover/50 px-2 py-0.5 rounded-sm transition-colors min-w-0"
      title={workspace.workingDir}
    >
      <FolderOpen size={12} className="text-chatroom-text-muted shrink-0" />
      <span className="text-[11px] font-bold text-chatroom-text-primary uppercase tracking-wider truncate">
        {getWorkspaceName(workspace.workingDir)}
      </span>
    </button>
  );

  return (
    <div className="flex items-center justify-between gap-1 w-full min-w-0 px-1">
      {/* ── Left: Workspace name + hostname ── */}
      <div className="flex items-center gap-1 min-w-0 shrink-0">
        {isLocal ? (
          <ContextMenu>
            <ContextMenuTrigger asChild>{workspaceNameEl}</ContextMenuTrigger>
            <ContextMenuContent className="min-w-[180px]">
              <ContextMenuItem
                onClick={() => void callLocalApi('open-finder', workspace.workingDir)}
              >
                <FolderOpen size={13} className="mr-2" />
                Open in Finder
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => void callLocalApi('open-vscode', workspace.workingDir)}
              >
                <Code2 size={13} className="mr-2" />
                Open in VS Code
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() =>
                  void callLocalApi('open-github-desktop', workspace.workingDir)
                }
              >
                <GitBranch size={13} className="mr-2" />
                Open in GitHub Desktop
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ) : (
          workspaceNameEl
        )}

        <span className="text-[10px] text-chatroom-text-muted">·</span>
        <span className="text-[10px] text-chatroom-text-muted uppercase tracking-wider truncate max-w-[140px]">
          {getWorkspaceDisplayHostname(workspace)}
        </span>
      </div>

      {/* ── Center: Git info ── */}
      {isAvailable && (
        <div className="flex items-center gap-2 min-w-0 flex-1 justify-center">
          {/* Branch + PR */}
          {(gitState.openPullRequests?.length ?? 0) > 0 ? (
            <a
              href={gitState.openPullRequests[0]!.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-[11px] text-chatroom-status-info hover:text-chatroom-accent transition-colors font-mono"
              title={gitState.openPullRequests[0]!.title}
            >
              <GitPullRequestIcon size={11} className="shrink-0" />
              <span className="uppercase tracking-wider truncate max-w-[160px]">
                {gitState.branch === 'HEAD' ? 'detached HEAD' : gitState.branch}
              </span>
              <span>(#{gitState.openPullRequests[0]!.number})</span>
            </a>
          ) : (
            <div className="inline-flex items-center gap-0.5 text-[11px] font-mono">
              <GitBranch size={11} className="text-chatroom-text-muted shrink-0" />
              <span className="text-chatroom-text-secondary uppercase tracking-wider truncate max-w-[160px]">
                {gitState.branch === 'HEAD' ? 'detached HEAD' : gitState.branch}
              </span>
            </div>
          )}

          {/* Diff stats */}
          <InlineDiffStat diffStat={gitState.diffStat} showFileCount={false} />

          {/* Remote link */}
          {primaryRemote && PlatformIcon && (
            <>
              <span className="text-[10px] text-chatroom-text-muted">·</span>
              {remoteHttpsUrl ? (
                <a
                  href={remoteHttpsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-chatroom-status-info hover:text-chatroom-accent transition-colors font-mono uppercase tracking-wider"
                  title={primaryRemote.url}
                >
                  <PlatformIcon size={11} className="shrink-0" />
                  {primaryRemote.name}
                </a>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] text-chatroom-text-muted font-mono uppercase tracking-wider">
                  <PlatformIcon size={11} className="shrink-0" />
                  {primaryRemote.name}
                </span>
              )}
            </>
          )}
        </div>
      )}

      {/* Loading state */}
      {gitState.status === 'loading' && (
        <div className="flex-1 flex justify-center">
          <span className="text-[10px] text-chatroom-text-muted">loading…</span>
        </div>
      )}

      {/* ── Right: Local action buttons ── */}
      {isLocal && (
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => void callLocalApi('open-finder', workspace.workingDir)}
            className="p-1 text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors rounded-sm hover:bg-chatroom-bg-hover/50"
            title="Open in Finder"
          >
            <FolderOpen size={12} />
          </button>
          <button
            type="button"
            onClick={() => void callLocalApi('open-vscode', workspace.workingDir)}
            className="p-1 text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors rounded-sm hover:bg-chatroom-bg-hover/50"
            title="Open in VS Code"
          >
            <Code2 size={12} />
          </button>
          <button
            type="button"
            onClick={() => void callLocalApi('open-github-desktop', workspace.workingDir)}
            className="p-1 text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors rounded-sm hover:bg-chatroom-bg-hover/50"
            title="Open in GitHub Desktop"
          >
            <GitBranch size={12} />
          </button>
        </div>
      )}
    </div>
  );
});

// ─── WorkspaceBottomBar ───────────────────────────────────────────────────────

/**
 * VS Code-style status bar at the bottom of the chatroom.
 * Displays the active workspace's git state and provides local actions.
 * Supports switching between multiple workspaces via a dropdown.
 */
export const WorkspaceBottomBar = memo(function WorkspaceBottomBar({
  workspaces,
  chatroomId,
  onRemoveWorkspace,
}: WorkspaceBottomBarProps) {
  // Resolve active workspace from localStorage or default to first
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(() =>
    getPersistedActiveWorkspaceId(chatroomId)
  );
  const [gitModalOpen, setGitModalOpen] = useState(false);

  // Ensure the persisted ID is valid — fall back to first workspace if not
  const validWorkspaces = useMemo(
    () => workspaces.filter((ws): ws is WorkspaceWithMachine => ws.machineId !== null),
    [workspaces]
  );

  const activeWorkspace = useMemo(() => {
    if (validWorkspaces.length === 0) return null;
    const persisted = validWorkspaces.find((ws) => ws.id === activeWorkspaceId);
    return persisted ?? validWorkspaces[0]!;
  }, [validWorkspaces, activeWorkspaceId]);

  // Keep localStorage in sync
  useEffect(() => {
    if (activeWorkspace) {
      setPersistedActiveWorkspaceId(chatroomId, activeWorkspace.id);
    }
  }, [activeWorkspace, chatroomId]);

  const handleSwitchWorkspace = useCallback(
    (workspaceId: string) => {
      setActiveWorkspaceId(workspaceId);
      setPersistedActiveWorkspaceId(chatroomId, workspaceId);
    },
    [chatroomId]
  );

  const handleOpenGitPanel = useCallback(() => {
    setGitModalOpen(true);
  }, []);

  const handleCloseGitPanel = useCallback(() => {
    setGitModalOpen(false);
  }, []);

  const handleRemove = useCallback(
    async (workspace: Workspace) => {
      if (!workspace._registryId || !onRemoveWorkspace) return;
      if (!window.confirm('Remove this workspace from the list?')) return;
      await onRemoveWorkspace(workspace._registryId);
    },
    [onRemoveWorkspace]
  );

  // Don't render anything if no workspaces
  if (validWorkspaces.length === 0) return null;

  return (
    <>
      {/* ── Bottom Bar ── */}
      <div className="border-t-2 border-chatroom-border-strong bg-chatroom-bg-surface flex items-center h-7 min-h-[28px] select-none">
        {/* Multi-workspace switcher (only shown when >1 workspace) */}
        {validWorkspaces.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-0.5 px-2 h-full text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover/50 transition-colors border-r border-chatroom-border-strong"
                title="Switch workspace"
              >
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  {validWorkspaces.length}
                </span>
                <ChevronDown size={10} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="min-w-[220px]">
              {validWorkspaces.map((ws) => (
                <DropdownMenuItem
                  key={ws.id}
                  onClick={() => handleSwitchWorkspace(ws.id)}
                  className={cn(
                    'text-[11px] font-mono flex items-center gap-2 cursor-pointer',
                    ws.id === activeWorkspace?.id && 'font-bold'
                  )}
                >
                  <FolderOpen size={12} className="shrink-0 text-chatroom-text-muted" />
                  <div className="flex flex-col min-w-0">
                    <span className="uppercase tracking-wider truncate">
                      {getWorkspaceName(ws.workingDir)}
                    </span>
                    <span className="text-[10px] text-chatroom-text-muted">
                      {getWorkspaceDisplayHostname(ws)}
                    </span>
                  </div>
                  {onRemoveWorkspace && ws._registryId && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleRemove(ws);
                      }}
                      className="ml-auto shrink-0 p-0.5 text-chatroom-text-muted hover:text-red-500 dark:hover:text-red-400 transition-colors"
                      title="Remove workspace"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Active workspace status */}
        {activeWorkspace && (
          <WorkspaceStatusContent
            workspace={activeWorkspace}
            onOpenGitPanel={handleOpenGitPanel}
          />
        )}
      </div>

      {/* ── Git Modal ── */}
      <FixedModal
        isOpen={gitModalOpen}
        onClose={handleCloseGitPanel}
        maxWidth="max-w-[96vw]"
        className="sm:!h-[92vh]"
      >
        <FixedModalContent>
          <FixedModalHeader onClose={handleCloseGitPanel}>
            <FixedModalTitle>
              <div className="flex items-center gap-2">
                <FolderOpen size={16} className="text-chatroom-text-muted" />
                <span className="text-xs font-bold uppercase tracking-wider text-chatroom-text-primary">
                  {activeWorkspace ? getWorkspaceName(activeWorkspace.workingDir) : ''}
                </span>
                {activeWorkspace && (
                  <span className="text-[11px] text-chatroom-text-muted">
                    {getWorkspaceDisplayHostname(activeWorkspace)}
                  </span>
                )}
              </div>
            </FixedModalTitle>
          </FixedModalHeader>
          <FixedModalBody className="p-0 overflow-hidden">
            {activeWorkspace && (
              <WorkspaceGitPanel
                machineId={activeWorkspace.machineId}
                workingDir={activeWorkspace.workingDir}
                chatroomId={chatroomId}
              />
            )}
          </FixedModalBody>
        </FixedModalContent>
      </FixedModal>
    </>
  );
});
