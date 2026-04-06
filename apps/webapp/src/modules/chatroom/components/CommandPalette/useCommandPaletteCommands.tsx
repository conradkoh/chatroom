'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRightLeft,
  ClipboardCheck,
  Code2,
  FileSearch,
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
  onOpenWorkspaceDetails?: (() => void) | null;
  /** Runnable commands for matching favorites to scripts */
  runnableCommands?: Array<{ name: string; script: string; source: string }>;
  /** Callback to open the Process Manager with a specific command selected */
  onOpenProcessManagerWithCommand?: (commandName: string) => void;
  /** Callback to open the Process Manager */
  onOpenProcessManager?: () => void;
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
  onOpenWorkspaceDetails,
  runnableCommands,
  onOpenProcessManagerWithCommand,
  onOpenProcessManager,
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
    if (runnableCommands && onOpenProcessManagerWithCommand) {
      const favoritesStore = getCommandFavoritesStore();
      const favorites = favoritesStore.getAll();

      for (const cmd of runnableCommands) {
        if (favorites.has(cmd.name)) {
          commands.push({
            id: `fav-${cmd.name}`,
            label: cmd.name,
            icon: <Terminal size={14} />,
            category: 'Commands',
            action: () => onOpenProcessManagerWithCommand(cmd.name),
          });
        }
      }
    }

    // ─── Navigate (shown first) ──────────────────────────
    commands.push(
      {
        id: 'nav-switch-chatroom',
        label: 'Switch Chatroom',
        icon: <ArrowRightLeft size={14} />,
        category: 'Navigate',
        shortcut: '⌘K',
        action: onOpenChatroomSwitcher,
      },
      {
        id: 'nav-go-to-file',
        label: 'Go to File',
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
        label: 'Open in VS Code',
        icon: <Code2 size={14} />,
        category: 'Actions',
        action: onOpenInVSCode,
      });
    }

    if (onOpenInGitHubDesktop) {
      commands.push({
        id: 'action-open-github-desktop',
        label: 'Open in GitHub Desktop',
        icon: <SiGithub size={14} />,
        category: 'Actions',
        action: onOpenInGitHubDesktop,
      });
    }

    if (onOpenPROnGitHub) {
      commands.push({
        id: 'action-open-pr-github',
        label: 'PR: Open on GitHub',
        icon: <GitPullRequest size={14} />,
        category: 'Actions',
        action: onOpenPROnGitHub,
      });
    }

    if (onOpenWorkspaceDetails) {
      commands.push({
        id: 'action-open-workspace-details',
        label: 'Open Workspace Details',
        icon: <PanelBottomOpen size={14} />,
        category: 'Actions',
        action: onOpenWorkspaceDetails,
      });
    }

    // ─── Panels ──────────────────────────────────────────
    commands.push(
      {
        id: 'panel-git',
        label: 'Show Git Panel',
        icon: <GitBranch size={14} />,
        category: 'Panels',
        action: onOpenGitPanel,
      },
      {
        id: 'panel-configuration',
        label: 'Show Configuration',
        icon: <Settings size={14} />,
        category: 'Panels',
        action: () => onOpenSettings('setup'),
      },
      {
        id: 'panel-event-stream',
        label: 'Show Event Stream',
        icon: <Activity size={14} />,
        category: 'Panels',
        action: onOpenEventStream,
      },
      {
        id: 'panel-pending-review',
        label: 'Show Pending Review',
        icon: <ClipboardCheck size={14} />,
        category: 'Panels',
        action: onOpenPendingReview,
      },
      {
        id: 'panel-backlog',
        label: 'Show Backlog',
        icon: <ListTodo size={14} />,
        category: 'Panels',
        action: onOpenBacklog,
      }
    );

    // ─── Process Manager ────────────────────────────────
    if (onOpenProcessManager) {
      commands.push({
        id: 'panel-process-manager',
        label: 'Open Process Manager',
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
    onOpenWorkspaceDetails,
    runnableCommands,
    onOpenProcessManagerWithCommand,
    onOpenProcessManager,
    favoritesVersion,
  ]);
}
