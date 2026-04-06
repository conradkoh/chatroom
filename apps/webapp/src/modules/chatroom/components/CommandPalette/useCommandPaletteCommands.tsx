'use client';

import { useMemo } from 'react';
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
  onOpenPRReview?: (() => void) | null;
  onOpenWorkspaceDetails?: (() => void) | null;
  /** Runnable commands for matching favorites to scripts */
  runnableCommands?: Array<{ name: string; script: string; source: string }>;
  /** Callback to open the Process Manager with a specific command selected */
  onOpenProcessManagerWithCommand?: (commandName: string) => void;
  /** Callback to directly execute a command (run + open terminal) */
  onRunCommand?: (commandName: string, script: string) => void;
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
  onOpenPRReview,
  onOpenWorkspaceDetails,
  runnableCommands,
  onOpenProcessManagerWithCommand,
  onRunCommand,
  onOpenProcessManager,
}: UseCommandPaletteCommandsProps): CommandItem[] {
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

    if (onOpenPRReview) {
      commands.push({
        id: 'action-pr-review-diff',
        label: 'PR: Review Diff',
        icon: <GitPullRequest size={14} />,
        category: 'Actions',
        action: onOpenPRReview,
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
    onOpenPRReview,
    onOpenWorkspaceDetails,
    runnableCommands,
    onOpenProcessManagerWithCommand,
    onRunCommand,
    onOpenProcessManager,
  ]);
}
