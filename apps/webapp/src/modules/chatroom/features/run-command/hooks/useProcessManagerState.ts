'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CommandRun, RunnableCommand } from '../types/run';
import { groupCommandsByWorkspace, type WorkspaceGroup } from '../utils/grouping';
import { isActiveRun } from '../utils/run-status';
import { useCommandFavorites } from './useCommandFavorites';

export interface ProcessManagerState {
  // Search
  searchQuery: string;
  setSearchQuery: (q: string) => void;

  // Selection
  selectedCommand: RunnableCommand | null;
  setSelectedCommand: (cmd: RunnableCommand | null) => void;
  selectedWorkspace: WorkspaceGroup | null;
  setSelectedWorkspace: (ws: WorkspaceGroup | null) => void;
  previousWorkspace: WorkspaceGroup | null;
  setPreviousWorkspace: (ws: WorkspaceGroup | null) => void;
  previousCommand: RunnableCommand | null;
  setPreviousCommand: (cmd: RunnableCommand | null) => void;

  // Keyboard navigation
  focusedIndex: number;
  setFocusedIndex: (i: number) => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;

  // Favorites (from useCommandFavorites hook)
  favorites: Set<string>;
  toggleFavorite: (name: string) => void;
  isFavorite: (name: string) => boolean;

  // Derived lists
  workspaceGroups: WorkspaceGroup[];
  runningProcesses: CommandRun[];
  recentRuns: CommandRun[];
}

type SelectableItem =
  | { type: 'workspace'; ws: WorkspaceGroup }
  | { type: 'command'; ws: WorkspaceGroup; cmd: RunnableCommand };

interface UseProcessManagerStateOptions {
  commands: RunnableCommand[];
  runs: CommandRun[];
  onClearRun: () => void;
  /** When provided, pre-select this command on mount. */
  initialSelectedCommand?: string | null;
  /** Called after the initial command has been consumed. */
  onConsumedInitialCommand?: () => void;
}

export function useProcessManagerState({
  commands,
  runs,
  onClearRun,
  initialSelectedCommand,
  onConsumedInitialCommand,
}: UseProcessManagerStateOptions): ProcessManagerState {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCommand, setSelectedCommand] = useState<RunnableCommand | null>(null);
  const [selectedWorkspace, setSelectedWorkspace] = useState<WorkspaceGroup | null>(null);
  const [previousWorkspace, setPreviousWorkspace] = useState<WorkspaceGroup | null>(null);
  const [previousCommand, setPreviousCommand] = useState<RunnableCommand | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [initialHandled, setInitialHandled] = useState(false);

  const { favorites, toggle: toggleFavorite, isFavorite } = useCommandFavorites();

  // Pre-select command from initialSelectedCommand
  useEffect(() => {
    if (initialHandled || !initialSelectedCommand || commands.length === 0) return;
    const cmd = commands.find((c) => c.name === initialSelectedCommand);
    if (cmd) {
      setSelectedCommand(cmd);
      setSelectedWorkspace(null);
      const groups = groupCommandsByWorkspace(commands, '');
      const ws = groups.find((g) => g.allCommands.some((c) => c.name === cmd.name));
      if (ws) setPreviousWorkspace(ws);
      setInitialHandled(true);
      onConsumedInitialCommand?.();
    }
  }, [initialSelectedCommand, commands, initialHandled, onConsumedInitialCommand]);

  // Reset initialHandled when initialSelectedCommand changes so next pre-select fires
  useEffect(() => {
    if (initialSelectedCommand) setInitialHandled(false);
  }, [initialSelectedCommand]);

  // Group commands
  const workspaceGroups = useMemo(
    () => groupCommandsByWorkspace(commands, searchQuery),
    [commands, searchQuery]
  );

  // Flat selectable items for keyboard nav
  const selectableItems = useMemo<SelectableItem[]>(() => {
    if (searchQuery) {
      return workspaceGroups.flatMap((ws) =>
        ws.allCommands.map((cmd) => ({ type: 'command' as const, ws, cmd }))
      );
    }
    return workspaceGroups.map((ws) => ({ type: 'workspace' as const, ws }));
  }, [workspaceGroups, searchQuery]);

  // Reset focus on search change
  useEffect(() => {
    setFocusedIndex(0);
  }, [searchQuery]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const items = selectableItems;
      if (items.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) => (prev + 1) % items.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) => (prev - 1 + items.length) % items.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = items[focusedIndex];
        if (!item) return;
        if (item.type === 'workspace') {
          onClearRun();
          setSelectedWorkspace(item.ws);
          setSelectedCommand(null);
        } else {
          onClearRun();
          setSelectedWorkspace(item.ws);
          setSelectedCommand(item.cmd);
        }
      }
    },
    [selectableItems, focusedIndex, onClearRun]
  );

  // Separate running/recent runs
  const runningProcesses = useMemo(() => runs.filter((r) => isActiveRun(r.status)), [runs]);
  const recentRuns = useMemo(
    () => runs.filter((r) => !isActiveRun(r.status)).slice(0, 10),
    [runs]
  );

  return {
    searchQuery,
    setSearchQuery,
    selectedCommand,
    setSelectedCommand,
    selectedWorkspace,
    setSelectedWorkspace,
    previousWorkspace,
    setPreviousWorkspace,
    previousCommand,
    setPreviousCommand,
    focusedIndex,
    setFocusedIndex,
    handleKeyDown,
    favorites,
    toggleFavorite,
    isFavorite,
    workspaceGroups,
    runningProcesses,
    recentRuns,
  };
}
