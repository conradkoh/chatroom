/**
 * Workspace Bottom Bar
 *
 * VS Code-style status bar at the bottom of the chatroom that displays
 * workspace information horizontally.
 *
 * Layout: <workspace selector> | <spacer> <remote>  <branch>  <diff stat>
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
import { CommitStatusIndicator } from './CommitStatusIndicator';
import { WorkspaceGitPanel } from './WorkspaceGitPanel';
import type { Workspace } from '../../types/workspace';
import { getWorkspaceDisplayHostname } from '../../types/workspace';
import { useWorkspaceGit } from '../hooks/useWorkspaceGit';
import type { GitRemote, CommitStatusSummary } from '../types/git';
import { useDaemonConnected } from '@/hooks/useDaemonConnected';
import { useSendLocalAction } from '@/hooks/useSendLocalAction';
import { toRepoHttpsUrl } from '@/lib/git-url';
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
import { useIsDesktop } from '@/hooks/useIsDesktop';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkspaceBottomBarProps {
  workspaces: Workspace[];
  chatroomId: string;
  /** Optional callback to register an imperative open action for the git panel (e.g. command palette) */
  onRegisterOpenGitPanel?: (open: (tab?: string) => void) => void;
}

/** A workspace guaranteed to have a machineId. */
type WorkspaceWithMachine = Workspace & { machineId: string };

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTIVE_WS_KEY_PREFIX = 'chatroom-active-workspace-';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getWorkspaceName(workingDir: string): string {
  return workingDir.split('/').filter(Boolean).pop() ?? workingDir;
}



type GitPlatform = 'github' | 'gitlab' | 'bitbucket' | 'generic';

function detectPlatform(remoteUrl: string): GitPlatform {
  const httpsUrl = toRepoHttpsUrl(remoteUrl);
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

// ─── Derived Git State ────────────────────────────────────────────────────────

/**
 * Derived values from workspace git state, shared across desktop and mobile components.
 * Avoids duplicating the same derivation logic in multiple components.
 */
interface DerivedGitInfo {
  isAvailable: boolean;
  isLoading: boolean;
  hasPR: boolean;
  branchDisplay: string;
  primaryRemote: GitRemote | undefined;
  repoHttpsUrl: string | null;
  isGitHubRepo: boolean;
  hasBranchActions: boolean;
  /** Remotes array (empty when not available). */
  remotes: GitRemote[];
  /** Open pull requests (empty when not available). */
  openPullRequests: { number: number; title: string; url: string }[];
  /** Diff stat (zeros when not available). */
  diffStat: { filesChanged: number; insertions: number; deletions: number };
  /** CI/CD status for the current branch head commit. */
  headCommitStatus: CommitStatusSummary | null;
}

function useDerivedGitInfo(workspace: WorkspaceWithMachine, isLocal: boolean): DerivedGitInfo {
  const gitState = useWorkspaceGit(workspace.machineId, workspace.workingDir);
  const isAvailable = gitState.status === 'available';
  const isLoading = gitState.status === 'loading';

  // Safely extract fields from the available state, defaulting for other states
  const remotes = isAvailable ? gitState.remotes : [];
  const openPullRequests = isAvailable ? gitState.openPullRequests : [];
  const diffStat = isAvailable ? gitState.diffStat : { filesChanged: 0, insertions: 0, deletions: 0 };
  const headCommitStatus = (isAvailable ? gitState.headCommitStatus : null) ?? null;

  const hasPR = openPullRequests.length > 0;
  const branchDisplay = isAvailable
    ? gitState.branch === 'HEAD'
      ? 'detached HEAD'
      : gitState.branch
    : '';

  const primaryRemote = remotes.find((r) => r.name === 'origin') ?? remotes[0];
  const repoHttpsUrl = primaryRemote ? toRepoHttpsUrl(primaryRemote.url) : null;
  const isGitHubRepo = primaryRemote
    ? detectPlatform(primaryRemote.url) === 'github'
    : false;

  const hasBranchActions = isLocal || !!repoHttpsUrl;

  return {
    isAvailable, isLoading, hasPR, branchDisplay, primaryRemote, repoHttpsUrl,
    isGitHubRepo, hasBranchActions, remotes, openPullRequests, diffStat,
    headCommitStatus,
  };
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
  const primaryHttpsUrl = toRepoHttpsUrl(primaryRemote.url);

  // Single remote — just render a link, no popover needed
  if (remotes.length === 1) {
    if (primaryHttpsUrl) {
      return (
        <a
          href={primaryHttpsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-chatroom-text-secondary hover:text-chatroom-text-primary transition-colors font-mono uppercase tracking-wider"
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
          className="inline-flex items-center gap-1 text-[11px] text-chatroom-text-secondary hover:text-chatroom-text-primary transition-colors font-mono uppercase tracking-wider"
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
          const httpsUrl = toRepoHttpsUrl(remote.url);
          return httpsUrl ? (
            <a
              key={remote.name}
              href={httpsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-2 py-1.5 text-[11px] font-mono uppercase tracking-wider text-chatroom-text-secondary hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover/50 rounded-none transition-colors"
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
 * Right-aligned git info: <remote>  <branch>  <diff stat | clean>
 * Branch is clickable → popover with "Open in GitHub Desktop" + "View PR on GitHub".
 * Diff stat is clickable → opens git panel.
 */
const WorkspaceStatusContent = memo(function WorkspaceStatusContent({
  workspace,
  onOpenGitPanel,
}: {
  workspace: WorkspaceWithMachine;
  onOpenGitPanel: () => void;
}) {
  const { isConnected: isLocal } = useDaemonConnected(workspace.machineId);
  const sendAction = useSendLocalAction();
  const { isAvailable, isLoading, hasPR, branchDisplay, repoHttpsUrl, isGitHubRepo, remotes, openPullRequests, diffStat, headCommitStatus } =
    useDerivedGitInfo(workspace, isLocal);

  // Show the popover if there's anything to show (local actions or repo link)
  const hasPopoverContent = isLocal || repoHttpsUrl;

  return (
    <div className="flex items-center gap-4 min-w-0 flex-1 px-4">
      {/* Spacer pushes everything to the right */}
      <div className="flex-1" />

      {isAvailable && (
        <>
          {/* Remote (first item, right-aligned) */}
          {remotes.length > 0 && (
            <RemotePopover remotes={remotes} />
          )}

          {/* Branch + PR + CI status — grouped together */}
          <div className="inline-flex items-center gap-0.5 shrink-0">
          {hasPopoverContent ? (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'inline-flex items-center gap-1 text-[11px] font-mono shrink-0 px-1.5 py-0.5 rounded-none transition-colors',
                    hasPR
                      ? 'text-chatroom-text-secondary hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover/50'
                      : 'text-chatroom-text-secondary hover:bg-chatroom-bg-hover/50'
                  )}
                  title={hasPR ? openPullRequests[0]!.title : branchDisplay}
                >
                  {hasPR ? (
                    <GitPullRequestIcon size={11} className="shrink-0" />
                  ) : (
                    <GitBranch size={11} className="shrink-0" />
                  )}
                  <span className="uppercase tracking-wider">{branchDisplay}</span>
                  {hasPR && <span>(#{openPullRequests[0]!.number})</span>}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" side="top" className="w-auto min-w-[200px] p-1">
                {isLocal && (
                  <button
                    type="button"
                    onClick={() =>
                      void sendAction(workspace.machineId, 'open-github-desktop', workspace.workingDir)
                    }
                    className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-chatroom-text-secondary hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover/50 rounded-none transition-colors w-full text-left"
                  >
                    <SiGithub size={12} className="shrink-0" />
                    Open in GitHub Desktop
                  </button>
                )}
                {repoHttpsUrl && (
                  hasPR ? (
                    <a
                      href={openPullRequests[0]!.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-chatroom-text-secondary hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover/50 rounded-none transition-colors"
                    >
                      {isGitHubRepo ? (
                        <SiGithub size={12} className="shrink-0" />
                      ) : (
                        <ExternalLink size={12} className="shrink-0" />
                      )}
                      {`View PR #${openPullRequests[0]!.number} on GitHub`}
                    </a>
                  ) : (
                    <span
                      className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-chatroom-text-muted cursor-not-allowed rounded-none"
                    >
                      {isGitHubRepo ? (
                        <SiGithub size={12} className="shrink-0 opacity-50" />
                      ) : (
                        <ExternalLink size={12} className="shrink-0 opacity-50" />
                      )}
                      View PR on GitHub
                    </span>
                  )
                )}
                {repoHttpsUrl && (
                  <a
                    href={repoHttpsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-chatroom-text-secondary hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover/50 rounded-none transition-colors"
                  >
                    {isGitHubRepo ? (
                      <SiGithub size={12} className="shrink-0" />
                    ) : (
                      <ExternalLink size={12} className="shrink-0" />
                    )}
                    View Repository
                  </a>
                )}
              </PopoverContent>
            </Popover>
          ) : (
            /* No popover content — static branch display */
            <div className="inline-flex items-center gap-1 text-[11px] font-mono shrink-0">
              <GitBranch size={11} className="text-chatroom-text-muted shrink-0" />
              <span className="text-chatroom-text-secondary uppercase tracking-wider">
                {branchDisplay}
              </span>
            </div>
          )}
          {headCommitStatus && (
            <CommitStatusIndicator status={headCommitStatus} />
          )}
          </div>

          {/* Diff stats — clickable, opens git panel */}
          <button
            type="button"
            onClick={onOpenGitPanel}
            className="shrink-0 hover:bg-chatroom-bg-hover/50 px-1.5 py-0.5 rounded-none transition-colors cursor-pointer flex items-center"
            title="Open workspace details"
          >
            <InlineDiffStat diffStat={diffStat} showFileCount={true} />
          </button>
        </>
      )}

      {/* Loading state */}
      {isLoading && (
        <span className="text-[10px] text-chatroom-text-muted">loading…</span>
      )}
    </div>
  );
});

// ─── MobileStatusContent ──────────────────────────────────────────────────

/**
 * Compact read-only status for mobile bottom bar.
 * Shows branch name, PR number, and diff stats — non-interactive.
 */
const MobileStatusContent = memo(function MobileStatusContent({
  workspace,
}: {
  workspace: WorkspaceWithMachine;
}) {
  const { isAvailable, isLoading, hasPR, branchDisplay, openPullRequests, diffStat, headCommitStatus } =
    useDerivedGitInfo(workspace, false);

  return (
    <div className="flex items-center gap-2 min-w-0 flex-1 px-2 overflow-hidden">
      {isAvailable && (
        <>
          {/* Branch + PR */}
          <div className="inline-flex items-center gap-1 text-[11px] font-mono shrink min-w-0">
            {hasPR ? (
              <GitPullRequestIcon size={11} className="text-chatroom-text-muted shrink-0" />
            ) : (
              <GitBranch size={11} className="text-chatroom-text-muted shrink-0" />
            )}
            <span className="text-chatroom-text-secondary uppercase tracking-wider truncate">
              {branchDisplay}
            </span>
            {hasPR && (
              <span className="text-chatroom-text-muted shrink-0">
                (#{openPullRequests[0]!.number})
              </span>
            )}
          </div>

          {/* Diff stats */}
          <div className="shrink-0">
            <InlineDiffStat diffStat={diffStat} showFileCount={false} />
          </div>

          {/* Commit status */}
          {headCommitStatus && (
            <CommitStatusIndicator status={headCommitStatus} />
          )}
        </>
      )}

      {isLoading && (
        <span className="text-[10px] text-chatroom-text-muted">loading…</span>
      )}
    </div>
  );
});

// ─── MobileWorkspaceModal ─────────────────────────────────────────────────────

/**
 * Fullscreen modal with workspace details in vertical layout for mobile.
 *
 * Four rows, each clickable to expand contextual actions:
 * 1. <folder> <machine name> → switch workspace / open details / local actions
 * 2. <origin> → show all remotes
 * 3. <branch> <pr> → open PR on GitHub / open in GitHub Desktop
 * 4. <diff> → open git details modal
 */
const MobileWorkspaceModal = memo(function MobileWorkspaceModal({
  workspace,
  allWorkspaces,
  isOpen,
  onClose,
  onOpenGitPanel,
  onSwitchWorkspace,
  isLocal,
  sendAction,
}: {
  workspace: WorkspaceWithMachine;
  allWorkspaces: WorkspaceWithMachine[];
  isOpen: boolean;
  onClose: () => void;
  onOpenGitPanel: () => void;
  onSwitchWorkspace: (workspaceId: string) => void;
  isLocal: boolean;
  sendAction: (machineId: string, action: 'open-vscode' | 'open-finder' | 'open-github-desktop', workingDir: string) => void;
}) {
  const { isAvailable, isLoading, hasPR, branchDisplay, repoHttpsUrl, isGitHubRepo, hasBranchActions, remotes, openPullRequests, diffStat, primaryRemote, headCommitStatus } =
    useDerivedGitInfo(workspace, isLocal);
  const [workspaceExpanded, setWorkspaceExpanded] = useState(false);
  const [remoteExpanded, setRemoteExpanded] = useState(false);
  const [branchExpanded, setBranchExpanded] = useState(false);

  const PrimaryRemoteIcon = primaryRemote ? getPlatformIcon(primaryRemote.url) : null;
  const hasMultipleWorkspaces = allWorkspaces.length > 1;
  const hasWorkspaceActions = hasMultipleWorkspaces || isLocal;
  const hasRemoteActions = remotes.length > 1;

  return (
    <FixedModal isOpen={isOpen} onClose={onClose} maxWidth="max-w-[96vw]">
      <FixedModalContent>
        <FixedModalHeader onClose={onClose}>
          <FixedModalTitle>
            <span className="text-xs font-bold uppercase tracking-wider text-chatroom-text-primary">
              Workspace
            </span>
          </FixedModalTitle>
        </FixedModalHeader>
        <FixedModalBody className="p-2">
          <div className="flex flex-col gap-0.5">
            {/* Row 1: Workspace / Machine */}
            <div className="flex flex-col">
              {hasWorkspaceActions ? (
                <button
                  type="button"
                  onClick={() => setWorkspaceExpanded((prev) => !prev)}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-none hover:bg-chatroom-bg-hover/50 transition-colors text-left w-full"
                >
                  <FolderOpen size={14} className="text-chatroom-text-muted shrink-0" />
                  <span className="text-[12px] font-bold text-chatroom-text-primary uppercase tracking-wider truncate">
                    {getWorkspaceName(workspace.workingDir)}
                  </span>
                  <span className="text-[11px] text-chatroom-text-muted truncate">
                    {getWorkspaceDisplayHostname(workspace)}
                  </span>
                  <ChevronDown
                    size={12}
                    className={cn(
                      'text-chatroom-text-muted shrink-0 transition-transform ml-auto',
                      workspaceExpanded && 'rotate-180'
                    )}
                  />
                </button>
              ) : (
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <FolderOpen size={14} className="text-chatroom-text-muted shrink-0" />
                  <span className="text-[12px] font-bold text-chatroom-text-primary uppercase tracking-wider truncate">
                    {getWorkspaceName(workspace.workingDir)}
                  </span>
                  <span className="text-[11px] text-chatroom-text-muted truncate">
                    {getWorkspaceDisplayHostname(workspace)}
                  </span>
                </div>
              )}
              {workspaceExpanded && (
                <div className="flex flex-col gap-0.5 ml-3 pl-4 border-l-2 border-chatroom-border-strong mb-1">
                  {/* Switch workspace options */}
                  {hasMultipleWorkspaces && allWorkspaces.filter((ws) => ws.id !== workspace.id).map((ws) => (
                    <button
                      key={ws.id}
                      type="button"
                      onClick={() => {
                        onSwitchWorkspace(ws.id);
                        setWorkspaceExpanded(false);
                      }}
                      className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-chatroom-text-secondary hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover/50 rounded-none transition-colors w-full text-left"
                    >
                      <FolderOpen size={12} className="shrink-0" />
                      <span className="font-mono uppercase tracking-wider truncate">{getWorkspaceName(ws.workingDir)}</span>
                      <span className="text-[10px] text-chatroom-text-muted truncate">{getWorkspaceDisplayHostname(ws)}</span>
                    </button>
                  ))}
                  {/* Open workspace details */}
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenGitPanel();
                    }}
                    className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-chatroom-text-secondary hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover/50 rounded-none transition-colors w-full text-left"
                  >
                    <PanelBottomOpen size={12} className="shrink-0" />
                    Open workspace details
                  </button>
                  {/* Local actions */}
                  {isLocal && (
                    <>
                      <button
                        type="button"
                        onClick={() => { void sendAction(workspace.machineId, 'open-finder', workspace.workingDir); onClose(); }}
                        className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-chatroom-text-secondary hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover/50 rounded-none transition-colors w-full text-left"
                      >
                        <FolderOpen size={12} className="shrink-0" />
                        Open in Finder
                      </button>
                      <button
                        type="button"
                        onClick={() => { void sendAction(workspace.machineId, 'open-vscode', workspace.workingDir); onClose(); }}
                        className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-chatroom-text-secondary hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover/50 rounded-none transition-colors w-full text-left"
                      >
                        <Code2 size={12} className="shrink-0" />
                        Open in VS Code
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {isAvailable && (
              <>
                {/* Row 2: Remote / Origin */}
                {remotes.length > 0 && PrimaryRemoteIcon && (
                  <div className="flex flex-col">
                    {hasRemoteActions ? (
                      <button
                        type="button"
                        onClick={() => setRemoteExpanded((prev) => !prev)}
                        className="flex items-center gap-2 px-3 py-2.5 rounded-none hover:bg-chatroom-bg-hover/50 transition-colors text-left w-full"
                      >
                        <PrimaryRemoteIcon size={14} className="text-chatroom-text-muted shrink-0" />
                        <span className="text-[12px] text-chatroom-text-secondary font-mono uppercase tracking-wider">
                          {primaryRemote!.name}
                        </span>
                        <ChevronDown
                          size={12}
                          className={cn(
                            'text-chatroom-text-muted shrink-0 transition-transform ml-auto',
                            remoteExpanded && 'rotate-180'
                          )}
                        />
                      </button>
                    ) : (
                      /* Single remote — link or static display */
                      (() => {
                        const httpsUrl = toRepoHttpsUrl(primaryRemote!.url);
                        return httpsUrl ? (
                          <a
                            href={httpsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-3 py-2.5 rounded-none hover:bg-chatroom-bg-hover/50 transition-colors"
                          >
                            <PrimaryRemoteIcon size={14} className="text-chatroom-text-muted shrink-0" />
                            <span className="text-[12px] text-chatroom-text-secondary font-mono uppercase tracking-wider">
                              {primaryRemote!.name}
                            </span>
                          </a>
                        ) : (
                          <div className="flex items-center gap-2 px-3 py-2.5">
                            <PrimaryRemoteIcon size={14} className="text-chatroom-text-muted shrink-0" />
                            <span className="text-[12px] text-chatroom-text-muted font-mono uppercase tracking-wider">
                              {primaryRemote!.name}
                            </span>
                          </div>
                        );
                      })()
                    )}
                    {remoteExpanded && (
                      <div className="flex flex-col gap-0.5 ml-3 pl-4 border-l-2 border-chatroom-border-strong mb-1">
                        {remotes.map((remote) => {
                          const RemoteIcon = getPlatformIcon(remote.url);
                          const httpsUrl = toRepoHttpsUrl(remote.url);
                          return httpsUrl ? (
                            <a
                              key={remote.name}
                              href={httpsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-chatroom-text-secondary hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover/50 rounded-none transition-colors"
                            >
                              <RemoteIcon size={12} className="shrink-0" />
                              {remote.name}
                            </a>
                          ) : (
                            <div
                              key={remote.name}
                              className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-chatroom-text-muted"
                            >
                              <RemoteIcon size={12} className="shrink-0" />
                              {remote.name}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Row 3: Branch + PR */}
                <div className="flex flex-col">
                  {hasBranchActions ? (
                    <button
                      type="button"
                      onClick={() => setBranchExpanded((prev) => !prev)}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-none hover:bg-chatroom-bg-hover/50 transition-colors text-left w-full"
                    >
                      {hasPR ? (
                        <GitPullRequestIcon size={14} className="text-chatroom-text-muted shrink-0" />
                      ) : (
                        <GitBranch size={14} className="text-chatroom-text-muted shrink-0" />
                      )}
                      <span className="text-[12px] text-chatroom-text-secondary font-mono uppercase tracking-wider truncate">
                        {branchDisplay}
                      </span>
                      {hasPR && (
                        <span className="text-[12px] text-chatroom-text-muted shrink-0">
                          (#{openPullRequests[0]!.number})
                        </span>
                      )}
                      <ChevronDown
                        size={12}
                        className={cn(
                          'text-chatroom-text-muted shrink-0 transition-transform ml-auto',
                          branchExpanded && 'rotate-180'
                        )}
                      />
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <GitBranch size={14} className="text-chatroom-text-muted shrink-0" />
                      <span className="text-[12px] text-chatroom-text-secondary font-mono uppercase tracking-wider">
                        {branchDisplay}
                      </span>
                    </div>
                  )}
                  {branchExpanded && (
                    <div className="flex flex-col gap-0.5 ml-3 pl-4 border-l-2 border-chatroom-border-strong mb-1">
                      {headCommitStatus && (
                        <div className="px-2 py-1">
                          <CommitStatusIndicator status={headCommitStatus} />
                        </div>
                      )}
                      {isLocal && (
                        <button
                          type="button"
                          onClick={() => { void sendAction(workspace.machineId, 'open-github-desktop', workspace.workingDir); onClose(); }}
                          className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-chatroom-text-secondary hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover/50 rounded-none transition-colors w-full text-left"
                        >
                          <SiGithub size={12} className="shrink-0" />
                          Open in GitHub Desktop
                        </button>
                      )}
                      {repoHttpsUrl && (
                        hasPR ? (
                          <a
                            href={openPullRequests[0]!.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-chatroom-text-secondary hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover/50 rounded-none transition-colors"
                            onClick={onClose}
                          >
                            {isGitHubRepo ? (
                              <SiGithub size={12} className="shrink-0" />
                            ) : (
                              <ExternalLink size={12} className="shrink-0" />
                            )}
                            {`View PR #${openPullRequests[0]!.number} on GitHub`}
                          </a>
                        ) : (
                          <span
                            className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-chatroom-text-muted cursor-not-allowed rounded-none"
                          >
                            {isGitHubRepo ? (
                              <SiGithub size={12} className="shrink-0 opacity-50" />
                            ) : (
                              <ExternalLink size={12} className="shrink-0 opacity-50" />
                            )}
                            View PR on GitHub
                          </span>
                        )
                      )}
                      {repoHttpsUrl && (
                        <a
                          href={repoHttpsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-chatroom-text-secondary hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover/50 rounded-none transition-colors"
                          onClick={onClose}
                        >
                          {isGitHubRepo ? (
                            <SiGithub size={12} className="shrink-0" />
                          ) : (
                            <ExternalLink size={12} className="shrink-0" />
                          )}
                          View Repository
                        </a>
                      )}
                    </div>
                  )}
                </div>

                {/* Row 4: Diff stats */}
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenGitPanel();
                  }}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-none hover:bg-chatroom-bg-hover/50 transition-colors text-left w-full"
                  title="Open workspace details"
                >
                  <InlineDiffStat diffStat={diffStat} showFileCount={true} />
                </button>
              </>
            )}

            {isLoading && (
              <div className="flex items-center px-3 py-2.5">
                <span className="text-[11px] text-chatroom-text-muted">Loading workspace info…</span>
              </div>
            )}
          </div>
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});

// ─── WorkspaceBottomBar ───────────────────────────────────────────────────────

export const WorkspaceBottomBar = memo(function WorkspaceBottomBar({
  workspaces,
  chatroomId,
  onRegisterOpenGitPanel,
}: WorkspaceBottomBarProps) {
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(() =>
    getPersistedActiveWorkspaceId(chatroomId)
  );
  const [gitModalOpen, setGitModalOpen] = useState(false);
  const [gitInitialTab, setGitInitialTab] = useState<string | undefined>(undefined);
  const [mobileModalOpen, setMobileModalOpen] = useState(false);
  const isDesktop = useIsDesktop(640);

  // Register git panel open callback for external triggers (e.g. command palette)
  useEffect(() => {
    onRegisterOpenGitPanel?.((tab?: string) => {
      setGitInitialTab(tab);
      setGitModalOpen(true);
    });
  }, [onRegisterOpenGitPanel]);

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
    setGitInitialTab(undefined);
  }, []);

  const handleOpenMobileModal = useCallback(() => {
    setMobileModalOpen(true);
  }, []);

  const handleCloseMobileModal = useCallback(() => {
    setMobileModalOpen(false);
  }, []);

  const { isConnected: isLocal } = useDaemonConnected(activeWorkspace?.machineId ?? null);
  const sendAction = useSendLocalAction();

  if (validWorkspaces.length === 0) return null;

  const workspaceTriggerLabel = activeWorkspace
    ? `${getWorkspaceName(activeWorkspace.workingDir)}`
    : '';

  const workspaceMachineLabel = activeWorkspace
    ? getWorkspaceDisplayHostname(activeWorkspace)
    : '';

  return (
    <>
      {/* ── Bottom Bar ── */}
      <div className="border-t-2 border-chatroom-border-strong bg-chatroom-bg-surface flex items-center h-8 min-h-[32px] select-none px-2" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {isDesktop ? (
          /* Desktop: full workspace selector + status */
          <>
            {/* Workspace selector — click to switch workspaces, sub-menu for actions */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2 px-3 h-full hover:bg-chatroom-bg-hover/50 transition-colors border-r border-chatroom-border-strong min-w-0"
                  title={activeWorkspace?.workingDir ?? ''}
                >
                  <FolderOpen size={12} className="text-chatroom-text-muted shrink-0" />
                  <span className="text-[11px] font-bold text-chatroom-text-primary uppercase tracking-wider truncate max-w-[340px]">
                    {workspaceTriggerLabel}
                  </span>
                  <span className="text-[10px] text-chatroom-text-muted uppercase tracking-wider truncate max-w-[200px]">
                    {workspaceMachineLabel}
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
                              onClick={() => void sendAction(ws.machineId, 'open-finder', ws.workingDir)}
                            >
                              <FolderOpen size={13} className="mr-2" />
                              Open in Finder
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => void sendAction(ws.machineId, 'open-vscode', ws.workingDir)}
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
          </>
        ) : (
          /* Mobile: entire bar is clickable → opens fullscreen modal */
          <button
            type="button"
            onClick={handleOpenMobileModal}
            className="flex items-center flex-1 min-w-0 h-full hover:bg-chatroom-bg-hover/50 transition-colors"
            title="View workspace details"
          >
            {activeWorkspace && (
              <MobileStatusContent workspace={activeWorkspace} />
            )}
          </button>
        )}
      </div>

      {/* ── Mobile Workspace Modal ── */}
      {!isDesktop && activeWorkspace && (
        <MobileWorkspaceModal
          workspace={activeWorkspace}
          allWorkspaces={validWorkspaces}
          isOpen={mobileModalOpen}
          onClose={handleCloseMobileModal}
          onOpenGitPanel={handleOpenGitPanel}
          onSwitchWorkspace={handleSwitchWorkspace}
          isLocal={isLocal}
          sendAction={sendAction}
        />
      )}

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
                initialTab={gitInitialTab as 'prs' | 'diff' | 'log' | 'pr-review' | undefined}
              />
            )}
          </FixedModalBody>
        </FixedModalContent>
      </FixedModal>
    </>
  );
});
