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
  RefreshCw,
  Settings,
  Square,
  Terminal,
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
  /** Currently running/recently stopped command runs */
  commandRuns?: Array<{ commandName: string; status: string; _id: string }>;
  /** Callback to stop a running command */
  onStopCommand?: (runId: string) => void;
  /** Callback to restart a command (re-run same command) */
  onRestartCommand?: (commandName: string, script: string) => void;
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
  onRunCommand,
  commandRuns,
  onStopCommand,
  onRestartCommand,
  onOpenProcessManager,
}: UseCommandPaletteCommandsProps): CommandItem[] {
  return useMemo<CommandItem[]>(() => {
    const commands: CommandItem[] = [];

    // ─── Running Commands (shown first, at top) ────────
    if (commandRuns && onStopCommand) {
      const runningRuns = commandRuns.filter((r) => r.status === 'running' || r.status === 'pending');
      for (const run of runningRuns) {
        commands.push({
          id: `running-stop-${run._id}`,
          label: `Stop: ${run.commandName}`,
          icon: <Square size={14} />,
          category: 'Running',
          action: () => onStopCommand(run._id),
        });
      }
    }

    // ─── Recently Stopped (restart) ─────────────────────
    if (commandRuns && onRestartCommand && runnableCommands) {
      const stoppedRuns = commandRuns
        .filter((r) => r.status === 'stopped' || r.status === 'completed' || r.status === 'failed')
        .slice(0, 5);
      for (const run of stoppedRuns) {
        const cmd = runnableCommands.find((c) => c.name === run.commandName);
        if (cmd) {
          commands.push({
            id: `restart-${run._id}`,
            label: `Restart: ${run.commandName}`,
            icon: <RefreshCw size={14} />,
            category: 'Recently Stopped',
            action: () => onRestartCommand(cmd.name, cmd.script),
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
    commandRuns,
    onStopCommand,
    onRestartCommand,
    onOpenProcessManager,
  ]);
}
