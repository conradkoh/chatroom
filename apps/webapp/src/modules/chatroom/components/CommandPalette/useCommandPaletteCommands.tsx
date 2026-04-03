'use client';

import { useMemo } from 'react';
import { Activity, ClipboardCheck, GitBranch, ListTodo, Settings } from 'lucide-react';

import type { CommandItem } from './types';

interface UseCommandPaletteCommandsProps {
  chatroomId: string;
  onOpenSettings: (tab: string) => void;
  onOpenEventStream: () => void;
  onOpenGitPanel: () => void;
  onOpenBacklog: () => void;
  onOpenPendingReview: () => void;
}

/**
 * Hook that builds the list of commands for the command palette.
 *
 * Currently provides panel navigation commands. Additional command categories
 * (e.g. chatroom actions, navigation) can be added here in future phases.
 */
export function useCommandPaletteCommands({
  onOpenSettings,
  onOpenEventStream,
  onOpenGitPanel,
  onOpenBacklog,
  onOpenPendingReview,
}: UseCommandPaletteCommandsProps): CommandItem[] {
  return useMemo<CommandItem[]>(
    () => [
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
      },
    ],
    [onOpenSettings, onOpenEventStream, onOpenGitPanel, onOpenBacklog, onOpenPendingReview]
  );
}
