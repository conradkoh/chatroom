'use client';

import { useMemo } from 'react';
import { Code2, GitPullRequest, PanelBottomOpen } from 'lucide-react';
import { SiGithub } from 'react-icons/si';

import { useDaemonConnected } from '@/hooks/useDaemonConnected';
import { useWorkspaceGit } from '../../workspace/hooks/useWorkspaceGit';
import { getWorkspaceDisplayHostname } from '../../types/workspace';
import type { Workspace } from '../../types/workspace';
import type { LocalActionType } from '@/hooks/useSendLocalAction';
import type { CommandItem } from './types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkspaceCommandCallbacks {
  sendAction: (machineId: string, action: LocalActionType, workingDir: string) => void;
  openExternalUrl: (url: string) => void;
  onOpenGitPanel: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Derive GitHub repo HTTPS URL from a remote URL. */
function toGitHubRepoUrl(remoteUrl: string): string | null {
  // SSH format: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/^git@github\.com:(.+?)(\.git)?$/);
  if (sshMatch) return `https://github.com/${sshMatch[1]}`;
  // HTTPS format: https://github.com/owner/repo.git
  const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/(.+?)(\.git)?$/);
  if (httpsMatch) return `https://github.com/${httpsMatch[1]}`;
  return null;
}

/**
 * Build a detail string for workspace disambiguation.
 * Shows hostname + last directory component of workingDir.
 * Only shown when isMulti is true.
 */
function getWorkspaceDetail(workspace: Workspace, isMulti: boolean): string | undefined {
  if (!isMulti) return undefined;
  const hostname = getWorkspaceDisplayHostname(workspace);
  const dir = workspace.workingDir;
  // Show last path component for brevity, or full path if short
  const shortDir = dir.split('/').filter(Boolean).pop() ?? dir;
  return `${hostname} — ${shortDir}`;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Generate command palette items for a single workspace.
 *
 * Calls `useWorkspaceGit` and `useDaemonConnected` hooks internally.
 * Must be called from a component that renders once per workspace.
 *
 * @param workspace  - The workspace to generate commands for.
 * @param isMulti    - Whether there are multiple workspaces (adds hostname suffix to labels).
 * @param callbacks  - Shared callbacks for executing workspace actions.
 */
export function useWorkspaceCommandItems(
  workspace: Workspace,
  isMulti: boolean,
  callbacks: WorkspaceCommandCallbacks
): CommandItem[] {
  const machineId = workspace.machineId ?? '';
  const workingDir = workspace.workingDir;
  const { isConnected } = useDaemonConnected(workspace.machineId);
  const gitState = useWorkspaceGit(machineId, workingDir);
  const { sendAction, openExternalUrl, onOpenGitPanel } = callbacks;

  return useMemo(() => {
    const items: CommandItem[] = [];
    const wsKey = workspace.id; // unique key per workspace
    const detail = getWorkspaceDetail(workspace, isMulti);
    const hostname = getWorkspaceDisplayHostname(workspace);

    // Only show machine actions when daemon is connected (local workspace)
    if (isConnected) {
      items.push({
        id: `ws-${wsKey}-open-vscode`,
        label: 'Machine: Open in VS Code',
        detail,
        icon: <Code2 size={14} />,
        category: 'Actions',
        keywords: ['vscode', 'editor', hostname, workspace.workingDir],
        action: () => sendAction(machineId, 'open-vscode', workingDir),
      });

      items.push({
        id: `ws-${wsKey}-open-github-desktop`,
        label: 'Machine: Open in GitHub Desktop',
        detail,
        icon: <SiGithub size={14} />,
        category: 'Actions',
        keywords: ['github desktop', hostname, workspace.workingDir],
        action: () => sendAction(machineId, 'open-github-desktop', workingDir),
      });
    }

    // Git-derived commands
    if (gitState.status === 'available') {
      const origin = gitState.remotes.find((r) => r.name === 'origin');
      const repoUrl = origin ? toGitHubRepoUrl(origin.url) : null;
      const pr = gitState.openPullRequests?.[0];

      if (repoUrl) {
        items.push({
          id: `ws-${wsKey}-view-github-prs`,
          label: 'Github: View Pull Requests',
          detail,
          icon: <SiGithub size={14} />,
          category: 'Actions',
          keywords: ['PR', 'PRs', hostname, workspace.workingDir],
          action: () => openExternalUrl(`${repoUrl}/pulls`),
        });

        items.push({
          id: `ws-${wsKey}-view-github-repo`,
          label: 'Github: View Repository',
          detail,
          icon: <SiGithub size={14} />,
          category: 'Actions',
          keywords: ['repo', 'repository', 'github', hostname, workspace.workingDir],
          action: () => openExternalUrl(repoUrl),
        });
      }

      if (pr) {
        items.push({
          id: `ws-${wsKey}-view-current-pr`,
          label: 'Github: View Current PR',
          detail,
          icon: <GitPullRequest size={14} />,
          category: 'Actions',
          keywords: ['PR', hostname, workspace.workingDir],
          action: () => openExternalUrl(pr.url),
        });

        items.push({
          id: `ws-${wsKey}-review-prs`,
          label: 'Chatroom: Review Pull Requests',
          detail,
          icon: <GitPullRequest size={14} />,
          category: 'Actions',
          keywords: ['PR', 'PRs', 'Review', hostname, workspace.workingDir],
          action: () => onOpenGitPanel(),
        });
      }
    }

    // Workspace details
    items.push({
      id: `ws-${wsKey}-workspace-details`,
      label: 'Machine: Workspace Details',
      detail,
      icon: <PanelBottomOpen size={14} />,
      category: 'Actions',
      keywords: ['workspace', 'details', hostname, workspace.workingDir],
      action: onOpenGitPanel,
    });

    return items;
  }, [workspace, isMulti, isConnected, gitState, machineId, workingDir, sendAction, openExternalUrl, onOpenGitPanel]);
}
