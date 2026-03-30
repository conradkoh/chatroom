/**
 * Workspace Bottom Bar
 *
 * VS Code-style status bar at the bottom of the chatroom that displays
 * workspace information horizontally.
 *
 * Layout: <workspace selector> | <spacer> <remote> · <branch> · <diff stat>
 *
 * Interactions:
 * - Click workspace selector → dropdown to switch workspaces, sub-menu for local actions
 * - Click remote → popover with all remotes
 * - Click diff stat / "Clean" → opens full-screen git panel
 */

'use client';

import {
  ChevronDown,
  Code2,
  ExternalLink,
  FolderOpen,
  GitBranch,
  GitPullRequest as GitPullRequestIcon,
  PanelBottomOpen,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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

const ACTIVE_WS_KEY_PREFIX = 'chatroom-active-workspace-';
const LOCAL_API_PORT = 19847;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getWorkspaceName(workingDir: string): string {
  return workingDir.split('/').filter(Boolean).pop() ?? workingDir;
}

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
    // Silent fail
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
    // Silent fail
  }
}

// ─── RemotePopover ────────────────────────────────────────────────────────────

/**
 * Clickable remote indicator that opens a popover with all remotes.
 * Shows the preferred remote (origin first) as the trigger.
 */
const RemotePopover = memo(function RemotePopover({ remotes }: { remotes: GitRemote[] }) {
  if (remotes.length === 0) return null;

  // Prefer "origin" as the display remote
  const primaryRemote = remotes.find((r) => r.name === 'origin') ?? remotes[0]!;
  const PrimaryIcon = getPlatformIcon(primaryRemote.url);
  const primaryHttpsUrl = toHttpsUrl(primaryRemote.url);

  // Single remote — just render a link, no popover needed
  if (remotes.length === 1) {
    if (primaryHttpsUrl) {
      return (
        <a
          href={primaryHttpsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-chatroom-status-info hover:text-chatroom-accent transition-colors font-mono uppercase tracking-wider"
          title={primaryRemote.url}
        >
          <PrimaryIcon size={11} className="shrink-0" />
          {primaryRemote.name}
        </a>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-chatroom-text-muted font-mono uppercase tracking-wider" title={primaryRemote.url}>
        <PrimaryIcon size={11} className="shrink-0" />
        {primaryRemote.name}
      </span>
    );
  }

  // Multiple remotes — popover
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] text-chatroom-status-info hover:text-chatroom-accent transition-colors font-mono uppercase tracking-wider"
          title="View remotes"
        >
          <PrimaryIcon size={11} className="shrink-0" />
          {primaryRemote.name}
          <ChevronDown size={9} className="text-chatroom-text-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-auto min-w-[180px] p-1">
        {remotes.map((remote) => {
          const RemoteIcon = getPlatformIcon(remote.url);
          const httpsUrl = toHttpsUrl(remote.url);
          return httpsUrl ? (
            <a
              key={remote.name}
              href={httpsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-2 py-1.5 text-[11px] font-mono uppercase tracking-wider text-chatroom-status-info hover:text-chatroom-accent hover:bg-chatroom-bg-hover/50 rounded-sm transition-colors"
              title={remote.url}
            >
              <RemoteIcon size={11} className="shrink-0" />
              {remote.name}
            </a>
          ) : (
            <div
              key={remote.name}
              className="flex items-center gap-2 px-2 py-1.5 text-[11px] font-mono uppercase tracking-wider text-chatroom-text-muted"
              title={remote.url}
            >
              <RemoteIcon size={11} className="shrink-0" />
              {remote.name}
            </div>
          );
        })}
      </PopoverContent>
    </Popover>
  );
});

// ─── WorkspaceStatusContent ───────────────────────────────────────────────────

/**
 * Right-aligned git info: <remote> · <branch> · <diff stat | clean>
 * Branch is clickable → popover with PR link + Open in GitHub Desktop.
 * Diff stat is clickable → opens git panel.
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

  const hasPR = isAvailable && (gitState.openPullRequests?.length ?? 0) > 0;
  const branchDisplay = isAvailable
    ? gitState.branch === 'HEAD'
      ? 'detached HEAD'
      : gitState.branch
    : '';

  // Determine if the branch popover has any content worth showing
  const hasPopoverContent = hasPR || isLocal;

  return (
    <div className="flex items-center gap-3 min-w-0 flex-1 px-3">
      {/* Spacer pushes everything to the right */}
      <div className="flex-1" />

      {isAvailable && (
        <>
          {/* Remote (first item, right-aligned) */}
          {gitState.remotes.length > 0 && (
            <>
              <RemotePopover remotes={gitState.remotes} />
              <span className="text-[10px] text-chatroom-text-muted shrink-0">·</span>
            </>
          )}

          {/* Branch + PR — clickable popover with PR link + GitHub Desktop */}
          {hasPopoverContent ? (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'inline-flex items-center gap-1 text-[11px] font-mono shrink-0 px-1.5 py-0.5 rounded-sm transition-colors',
                    hasPR
                      ? 'text-chatroom-status-info hover:text-chatroom-accent hover:bg-chatroom-bg-hover/50'
                      : 'text-chatroom-text-secondary hover:bg-chatroom-bg-hover/50'
                  )}
                  title={hasPR ? gitState.openPullRequests[0]!.title : branchDisplay}
                >
                  {hasPR ? (
                    <GitPullRequestIcon size={11} className="shrink-0" />
                  ) : (
                    <GitBranch size={11} className="shrink-0" />
                  )}
                  <span className="uppercase tracking-wider">{branchDisplay}</span>
                  {hasPR && <span>(#{gitState.openPullRequests[0]!.number})</span>}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" side="top" className="w-auto min-w-[200px] p-1">
                {hasPR && (
                  <a
                    href={gitState.openPullRequests[0]!.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-2 py-1.5 text-[11px] font-mono text-chatroom-status-info hover:text-chatroom-accent hover:bg-chatroom-bg-hover/50 rounded-sm transition-colors"
                    title={gitState.openPullRequests[0]!.title}
                  >
                    <GitPullRequestIcon size={12} className="shrink-0" />
                    <span className="truncate">{gitState.openPullRequests[0]!.title}</span>
                  </a>
                )}
                {isLocal && (
                  <button
                    type="button"
                    onClick={() =>
                      void callLocalApi('open-github-desktop', workspace.workingDir)
                    }
                    className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-chatroom-text-secondary hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover/50 rounded-sm transition-colors w-full text-left"
                  >
                    <GitBranch size={12} className="shrink-0" />
                    Open in GitHub Desktop
                  </button>
                )}
              </PopoverContent>
            </Popover>
          ) : (
            /* Non-local, no PR — static branch display */
            <div className="inline-flex items-center gap-1 text-[11px] font-mono shrink-0">
              <GitBranch size={11} className="text-chatroom-text-muted shrink-0" />
              <span className="text-chatroom-text-secondary uppercase tracking-wider">
                {branchDisplay}
              </span>
            </div>
          )}

          {/* Separator */}
          <span className="text-[10px] text-chatroom-text-muted shrink-0">·</span>

          {/* Diff stats — clickable, opens git panel */}
          <button
            type="button"
            onClick={onOpenGitPanel}
            className="shrink-0 hover:bg-chatroom-bg-hover/50 px-1.5 py-0.5 rounded-sm transition-colors cursor-pointer"
            title="Open workspace details"
          >
            <InlineDiffStat diffStat={gitState.diffStat} showFileCount={true} />
          </button>
        </>
      )}

      {/* Loading state */}
      {gitState.status === 'loading' && (
        <span className="text-[10px] text-chatroom-text-muted">loading…</span>
      )}
    </div>
  );
});

// ─── WorkspaceBottomBar ───────────────────────────────────────────────────────

export const WorkspaceBottomBar = memo(function WorkspaceBottomBar({
  workspaces,
  chatroomId,
}: WorkspaceBottomBarProps) {
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(() =>
    getPersistedActiveWorkspaceId(chatroomId)
  );
  const [gitModalOpen, setGitModalOpen] = useState(false);

  const validWorkspaces = useMemo(
    () => workspaces.filter((ws): ws is WorkspaceWithMachine => ws.machineId !== null),
    [workspaces]
  );

  const activeWorkspace = useMemo(() => {
    if (validWorkspaces.length === 0) return null;
    const persisted = validWorkspaces.find((ws) => ws.id === activeWorkspaceId);
    return persisted ?? validWorkspaces[0]!;
  }, [validWorkspaces, activeWorkspaceId]);

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

  const { isLocal } = useLocalDaemon();

  if (validWorkspaces.length === 0) return null;

  const workspaceTriggerLabel = activeWorkspace
    ? `${getWorkspaceName(activeWorkspace.workingDir)} · ${getWorkspaceDisplayHostname(activeWorkspace)}`
    : '';

  return (
    <>
      {/* ── Bottom Bar ── */}
      <div className="border-t-2 border-chatroom-border-strong bg-chatroom-bg-surface flex items-center h-8 min-h-[32px] select-none px-1">
        {/* Workspace selector — click to switch workspaces, sub-menu for actions */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1.5 px-3 h-full hover:bg-chatroom-bg-hover/50 transition-colors border-r border-chatroom-border-strong min-w-0"
              title={activeWorkspace?.workingDir ?? ''}
            >
              <FolderOpen size={12} className="text-chatroom-text-muted shrink-0" />
              <span className="text-[11px] font-bold text-chatroom-text-primary uppercase tracking-wider truncate max-w-[200px]">
                {workspaceTriggerLabel}
              </span>
              <ChevronDown size={10} className="text-chatroom-text-muted shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="min-w-[280px]">
            {validWorkspaces.map((ws) => {
              const isActive = ws.id === activeWorkspace?.id;
              return (
                <DropdownMenuSub key={ws.id}>
                  <DropdownMenuSubTrigger
                    className={cn(
                      'text-[11px] flex items-center gap-2 cursor-pointer py-2',
                      isActive && 'bg-chatroom-bg-hover/50'
                    )}
                    onClick={() => handleSwitchWorkspace(ws.id)}
                  >
                    <FolderOpen
                      size={12}
                      className={cn(
                        'shrink-0',
                        isActive ? 'text-chatroom-text-primary' : 'text-chatroom-text-muted'
                      )}
                    />
                    <div className="flex flex-col min-w-0 flex-1">
                      <span
                        className={cn(
                          'font-mono uppercase tracking-wider truncate',
                          isActive ? 'font-bold text-chatroom-text-primary' : ''
                        )}
                      >
                        {getWorkspaceName(ws.workingDir)}
                      </span>
                      <span className="text-[10px] text-chatroom-text-muted">
                        {getWorkspaceDisplayHostname(ws)}
                      </span>
                    </div>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="min-w-[180px]">
                    <DropdownMenuItem
                      onClick={() => {
                        handleSwitchWorkspace(ws.id);
                        handleOpenGitPanel();
                      }}
                    >
                      <PanelBottomOpen size={13} className="mr-2" />
                      Open workspace details
                    </DropdownMenuItem>
                    {isLocal && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => void callLocalApi('open-finder', ws.workingDir)}
                        >
                          <FolderOpen size={13} className="mr-2" />
                          Open in Finder
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => void callLocalApi('open-vscode', ws.workingDir)}
                        >
                          <Code2 size={13} className="mr-2" />
                          Open in VS Code
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Active workspace git status — right-aligned */}
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
