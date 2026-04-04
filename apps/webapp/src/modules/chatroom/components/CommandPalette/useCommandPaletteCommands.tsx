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
  Play,
  Settings,
} from 'lucide-react';
import { SiGithub } from 'react-icons/si';

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
  /** Runnable commands discovered from workspace package.json/turbo.json */
  runnableCommands?: Array<{ name: string; script: string; source: string }>;
  /** Callback when user selects a runnable command */
  onRunCommand?: (commandName: string, script: string) => void;
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
  onRunCommand,
}: UseCommandPaletteCommandsProps): CommandItem[] {
  return useMemo<CommandItem[]>(() => {
    const commands: CommandItem[] = [];

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
        label: 'PR: Open in GitHub Desktop',
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

    // ─── Run Script (dynamically discovered) ────────
    if (runnableCommands && onRunCommand) {
      for (const cmd of runnableCommands) {
        commands.push({
          id: `run-${cmd.source}-${cmd.name}`,
          label: cmd.name,
          icon: <Play size={14} />,
          category: 'Run Script',
          action: () => onRunCommand(cmd.name, cmd.script),
        });
      }
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
    onRunCommand,
  ]);
}
