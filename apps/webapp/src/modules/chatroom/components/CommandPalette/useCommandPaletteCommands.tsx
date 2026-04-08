'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRightLeft,
  ClipboardCheck,
  Code2,
  FileSearch,
  FolderTree,
  GitBranch,
  GitPullRequest,
  ListTodo,
  PanelBottomOpen,
  Settings,
  Terminal,
} from 'lucide-react';
import { SiGithub } from 'react-icons/si';

import { getCommandFavoritesStore } from '../../lib/commandFavoritesStore';
import type { CommandItem } from './types';

export type SettingsTab = 'setup' | 'team' | 'machine' | 'agents' | 'integrations';

interface UseCommandPaletteCommandsProps {
  onOpenSettings: (tab: SettingsTab) => void;
  onOpenEventStream: () => void;
  onOpenGitPanel: () => void;
  onOpenBacklog: () => void;
  onOpenPendingReview: () => void;
  /** Navigation callbacks */
  onOpenChatroomSwitcher: () => void;
  onOpenFileSelector: () => void;
  /** Workspace action callbacks — conditionally available */
  onOpenInVSCode?: (() => void) | null;
  onOpenInGitHubDesktop?: (() => void) | null;
  onOpenPROnGitHub?: (() => void) | null;
  onOpenPRReview?: (() => void) | null;
  onViewGitHubPullRequests?: (() => void) | null;
  onOpenWorkspaceDetails?: (() => void) | null;
  /** Runnable commands for matching favorites to scripts */
  runnableCommands?: Array<{ name: string; script: string; source: string }>;
  /** Callback to open the Process Manager with a specific command selected */
  onOpenProcessManagerWithCommand?: (commandName: string) => void;
  /** Callback to directly execute a command (run + open terminal) */
  onRunCommand?: (commandName: string, script: string) => void;
  /** Callback to open the Process Manager */
  onOpenProcessManager?: () => void;
  /** Callback to open the File Explorer */
  onOpenFileExplorer?: (() => void) | null;
}

/**
 * Hook that builds the list of commands for the command palette.
 *
 * Provides panel navigation commands and workspace action commands.
 * Action commands are conditionally included based on workspace availability.
 */
export function useCommandPaletteCommands({
  onOpenSettings,
  onOpenEventStream,
  onOpenGitPanel,
  onOpenBacklog,
  onOpenPendingReview,
  onOpenChatroomSwitcher,
  onOpenFileSelector,
  onOpenInVSCode,
  onOpenInGitHubDesktop,
  onOpenPROnGitHub,
  onOpenPRReview,
  onViewGitHubPullRequests,
  onOpenWorkspaceDetails,
  runnableCommands,
  onOpenProcessManagerWithCommand,
  onRunCommand,
  onOpenProcessManager,
  onOpenFileExplorer,
}: UseCommandPaletteCommandsProps): CommandItem[] {
  // Track favorites changes from Process Manager via custom event
  const [favoritesVersion, setFavoritesVersion] = useState(0);
  useEffect(() => {
    const handler = () => setFavoritesVersion((v) => v + 1);
    window.addEventListener('chatroom:favorites-changed', handler);
    return () => window.removeEventListener('chatroom:favorites-changed', handler);
  }, []);

  return useMemo<CommandItem[]>(() => {
    const commands: CommandItem[] = [];

    // ─── Favorites (favourited commands from process manager) ────────
    if (runnableCommands && (onRunCommand || onOpenProcessManagerWithCommand)) {
      const favoritesStore = getCommandFavoritesStore();
      const favorites = favoritesStore.getAll();

      for (const cmd of runnableCommands) {
        if (favorites.has(cmd.name)) {
          commands.push({
            id: `fav-${cmd.name}`,
            label: cmd.name,
            icon: <Terminal size={14} />,
            category: 'Commands',
            action: () => {
              if (onRunCommand) {
                onRunCommand(cmd.name, cmd.script);
              } else if (onOpenProcessManagerWithCommand) {
                onOpenProcessManagerWithCommand(cmd.name);
              }
            },
          });
        }
      }
    }

    // ─── Navigate (shown first) ──────────────────────────
    commands.push(
      {
        id: 'nav-switch-chatroom',
        label: 'Chatroom: Switch Chatroom',
        icon: <ArrowRightLeft size={14} />,
        category: 'Navigate',
        shortcut: '⌘K',
        action: onOpenChatroomSwitcher,
      },
      {
        id: 'nav-go-to-file',
        label: 'Chatroom: Go to File',
        icon: <FileSearch size={14} />,
        category: 'Navigate',
        shortcut: '⌘P',
        action: onOpenFileSelector,
      }
    );

    // ─── Actions (conditionally included) ────────────────
    if (onOpenInVSCode) {
      commands.push({
        id: 'action-open-vscode',
        label: 'Machine: Open in VS Code',
        icon: <Code2 size={14} />,
        category: 'Actions',
        action: onOpenInVSCode,
      });
    }

    if (onOpenInGitHubDesktop) {
      commands.push({
        id: 'action-open-github-desktop',
        label: 'Machine: Open in GitHub Desktop',
        icon: <SiGithub size={14} />,
        category: 'Actions',
        action: onOpenInGitHubDesktop,
      });
    }

    if (onViewGitHubPullRequests) {
      commands.push({
        id: 'action-view-github-prs',
        label: 'Github: View Pull Requests',
        icon: <SiGithub size={14} />,
        category: 'Actions',
        keywords: ['PR', 'PRs'],
        action: onViewGitHubPullRequests,
      });
    }

    if (onOpenPROnGitHub) {
      commands.push({
        id: 'action-open-pr-github',
        label: 'Github: View Current PR',
        icon: <GitPullRequest size={14} />,
        category: 'Actions',
        keywords: ['PR'],
        action: onOpenPROnGitHub,
      });
    }

    if (onOpenPRReview) {
      commands.push({
        id: 'action-pr-review-diff',
        label: 'Chatroom: Review Pull Requests',
        icon: <GitPullRequest size={14} />,
        category: 'Actions',
        keywords: ['PR', 'PRs', 'Review'],
        action: onOpenPRReview,
      });
    }

    if (onOpenWorkspaceDetails) {
      commands.push({
        id: 'action-open-workspace-details',
        label: 'Machine: Workspace Details',
        icon: <PanelBottomOpen size={14} />,
        category: 'Actions',
        action: onOpenWorkspaceDetails,
      });
    }

    // ─── Panels ──────────────────────────────────────────
    commands.push(
      {
        id: 'panel-git',
        label: 'Chatroom: Git Panel',
        icon: <GitBranch size={14} />,
        category: 'Panels',
        action: onOpenGitPanel,
      },
      {
        id: 'panel-configuration',
        label: 'Chatroom: Configuration',
        icon: <Settings size={14} />,
        category: 'Panels',
        action: () => onOpenSettings('setup'),
      },
      {
        id: 'panel-event-stream',
        label: 'Chatroom: Event Stream',
        icon: <Activity size={14} />,
        category: 'Panels',
        action: onOpenEventStream,
      },
      {
        id: 'panel-pending-review',
        label: 'Chatroom: Pending Review',
        icon: <ClipboardCheck size={14} />,
        category: 'Panels',
        action: onOpenPendingReview,
      },
      {
        id: 'panel-backlog',
        label: 'Chatroom: Backlog',
        icon: <ListTodo size={14} />,
        category: 'Panels',
        action: onOpenBacklog,
      }
    );

    // ─── File Explorer ─────────────────────────────────
    if (onOpenFileExplorer) {
      commands.push({
        id: 'panel-file-explorer',
        label: 'Chatroom: Open File Explorer',
        icon: <FolderTree size={14} />,
        category: 'Panels',
        keywords: ['files', 'tree', 'explorer', 'workspace'],
        action: onOpenFileExplorer,
      });
    }

    // ─── Process Manager ────────────────────────────────
    if (onOpenProcessManager) {
      commands.push({
        id: 'panel-process-manager',
        label: 'Chatroom: Process Manager',
        icon: <Terminal size={14} />,
        category: 'Panels',
        action: onOpenProcessManager,
      });
    }

    return commands;
  }, [
    onOpenSettings,
    onOpenEventStream,
    onOpenGitPanel,
    onOpenBacklog,
    onOpenPendingReview,
    onOpenChatroomSwitcher,
    onOpenFileSelector,
    onOpenInVSCode,
    onOpenInGitHubDesktop,
    onOpenPROnGitHub,
    onOpenPRReview,
    onViewGitHubPullRequests,
    onOpenWorkspaceDetails,
    runnableCommands,
    onOpenProcessManagerWithCommand,
    onRunCommand,
    onOpenProcessManager,
    onOpenFileExplorer,
    favoritesVersion,
  ]);
}
