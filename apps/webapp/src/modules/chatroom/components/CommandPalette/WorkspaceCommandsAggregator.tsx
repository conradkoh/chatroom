'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';

import type { LocalActionType } from '@/hooks/useSendLocalAction';

import type { Workspace } from '../../types/workspace';
import type { CommandItem } from './types';
import { useWorkspaceCommandItems } from './useWorkspaceCommandItems';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkspaceCommandCallbacks {
  sendAction: (machineId: string, action: LocalActionType, workingDir: string) => void;
  openExternalUrl: (url: string) => void;
  onOpenGitPanel: () => void;
}

interface WorkspaceCommandsAggregatorProps {
  workspaces: Workspace[];
  callbacks: WorkspaceCommandCallbacks;
  onCommandsChange: (commands: CommandItem[]) => void;
}

// ─── Per-Workspace Watcher (invisible) ────────────────────────────────────────

interface WorkspaceWatcherProps {
  workspace: Workspace;
  isMulti: boolean;
  callbacks: WorkspaceCommandCallbacks;
  onUpdate: (workspaceId: string, items: CommandItem[]) => void;
}

const WorkspaceWatcher = memo(function WorkspaceWatcher({
  workspace,
  isMulti,
  callbacks,
  onUpdate,
}: WorkspaceWatcherProps) {
  const items = useWorkspaceCommandItems(workspace, isMulti, callbacks);

  useEffect(() => {
    onUpdate(workspace.id, items);
  }, [workspace.id, items, onUpdate]);

  return null; // invisible component — only subscribes to hooks
});

// ─── Aggregator ───────────────────────────────────────────────────────────────

/**
 * Renders one invisible WorkspaceWatcher per workspace.
 * Aggregates their command items and reports the combined list via `onCommandsChange`.
 *
 * This pattern allows each workspace to call its own React hooks
 * (`useWorkspaceGit`, `useDaemonConnected`) while respecting the rules of hooks.
 */
export const WorkspaceCommandsAggregator = memo(function WorkspaceCommandsAggregator({
  workspaces,
  callbacks,
  onCommandsChange,
}: WorkspaceCommandsAggregatorProps) {
  // Store per-workspace command items in a ref-backed map to avoid render loops
  const itemsMapRef = useRef<Map<string, CommandItem[]>>(new Map());
  const [, forceUpdate] = useState(0);

  const validWorkspaces = workspaces.filter((ws) => ws.machineId !== null);
  const isMulti = validWorkspaces.length > 1;

  // Clean up removed workspaces
  useEffect(() => {
    const validIds = new Set(validWorkspaces.map((ws) => ws.id));
    let changed = false;
    for (const key of itemsMapRef.current.keys()) {
      if (!validIds.has(key)) {
        itemsMapRef.current.delete(key);
        changed = true;
      }
    }
    if (changed) forceUpdate((v) => v + 1);
  }, [validWorkspaces]);

  const handleUpdate = useCallback((workspaceId: string, items: CommandItem[]) => {
    itemsMapRef.current.set(workspaceId, items);
    forceUpdate((v) => v + 1);
  }, []);

  // Aggregate all workspace commands and notify parent
  useEffect(() => {
    const allItems: CommandItem[] = [];
    for (const items of itemsMapRef.current.values()) {
      allItems.push(...items);
    }
    onCommandsChange(allItems);
  });

  return (
    <>
      {validWorkspaces.map((ws) => (
        <WorkspaceWatcher
          key={ws.id}
          workspace={ws}
          isMulti={isMulti}
          callbacks={callbacks}
          onUpdate={handleUpdate}
        />
      ))}
    </>
  );
});
