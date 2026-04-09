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
 * Append workspace hostname suffix when there are multiple workspaces.
 * Single workspace → no suffix (backward compatible).
 */
function withWorkspaceSuffix(label: string, workspace: Workspace, isMulti: boolean): string {
  if (!isMulti) return label;
  const hostname = getWorkspaceDisplayHostname(workspace);
  return `${label} (${hostname})`;
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

    // Only show machine actions when daemon is connected (local workspace)
    if (isConnected) {
      items.push({
        id: `ws-${wsKey}-open-vscode`,
        label: withWorkspaceSuffix('Machine: Open in VS Code', workspace, isMulti),
        icon: <Code2 size={14} />,
        category: 'Actions',
        keywords: ['vscode', 'editor', getWorkspaceDisplayHostname(workspace)],
        action: () => sendAction(machineId, 'open-vscode', workingDir),
      });

      items.push({
        id: `ws-${wsKey}-open-github-desktop`,
        label: withWorkspaceSuffix('Machine: Open in GitHub Desktop', workspace, isMulti),
        icon: <SiGithub size={14} />,
        category: 'Actions',
        keywords: ['github desktop', getWorkspaceDisplayHostname(workspace)],
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
          label: withWorkspaceSuffix('Github: View Pull Requests', workspace, isMulti),
          icon: <SiGithub size={14} />,
          category: 'Actions',
          keywords: ['PR', 'PRs', getWorkspaceDisplayHostname(workspace)],
          action: () => openExternalUrl(`${repoUrl}/pulls`),
        });

        items.push({
          id: `ws-${wsKey}-view-github-repo`,
          label: withWorkspaceSuffix('Github: View Repository', workspace, isMulti),
          icon: <SiGithub size={14} />,
          category: 'Actions',
          keywords: ['repo', 'repository', 'github', getWorkspaceDisplayHostname(workspace)],
          action: () => openExternalUrl(repoUrl),
        });
      }

      if (pr) {
        items.push({
          id: `ws-${wsKey}-view-current-pr`,
          label: withWorkspaceSuffix('Github: View Current PR', workspace, isMulti),
          icon: <GitPullRequest size={14} />,
          category: 'Actions',
          keywords: ['PR', getWorkspaceDisplayHostname(workspace)],
          action: () => openExternalUrl(pr.url),
        });

        items.push({
          id: `ws-${wsKey}-review-prs`,
          label: withWorkspaceSuffix('Chatroom: Review Pull Requests', workspace, isMulti),
          icon: <GitPullRequest size={14} />,
          category: 'Actions',
          keywords: ['PR', 'PRs', 'Review', getWorkspaceDisplayHostname(workspace)],
          action: () => onOpenGitPanel(),
        });
      }
    }

    // Workspace details
    items.push({
      id: `ws-${wsKey}-workspace-details`,
      label: withWorkspaceSuffix('Machine: Workspace Details', workspace, isMulti),
      icon: <PanelBottomOpen size={14} />,
      category: 'Actions',
      keywords: ['workspace', 'details', getWorkspaceDisplayHostname(workspace)],
      action: onOpenGitPanel,
    });

    return items;
  }, [workspace, isMulti, isConnected, gitState, machineId, workingDir, sendAction, openExternalUrl, onOpenGitPanel]);
}
