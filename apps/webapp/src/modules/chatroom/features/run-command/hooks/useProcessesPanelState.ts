'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

import { useCommandFavorites } from './useCommandFavorites';
import type { CommandRun, RunnableCommand } from '../types/run';
import { groupCommandsByWorkspace, type WorkspaceGroup } from '../utils/grouping';
import { isActiveRun } from '../utils/run-status';

export interface ProcessesPanelState {
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

interface UseProcessesPanelStateOptions {
  commands: RunnableCommand[];
  runs: CommandRun[];
  onClearRun: () => void;
  /** When provided, pre-select this command on mount. */
  initialSelectedCommand?: string | null;
  /** Called after the initial command has been consumed. */
  onConsumedInitialCommand?: () => void;
}

export function useProcessesPanelState({
  commands,
  runs,
  onClearRun,
  initialSelectedCommand,
  onConsumedInitialCommand,
}: UseProcessesPanelStateOptions): ProcessesPanelState {
  const [searchQuery, setSearchQuery] = useState('');
  const initialCommand = useMemo(() => {
    if (!initialSelectedCommand) return null;
    return commands.find((command) => command.name === initialSelectedCommand) ?? null;
  }, [commands, initialSelectedCommand]);
  const [userSelectedCommand, setUserSelectedCommand] = useState<RunnableCommand | null>(null);
  const selectedCommand = userSelectedCommand ?? initialCommand;
  const [userSelectedWorkspace, setUserSelectedWorkspace] = useState<WorkspaceGroup | null>(null);
  const selectedWorkspace = userSelectedWorkspace;
  const [previousWorkspace, setPreviousWorkspace] = useState<WorkspaceGroup | null>(null);
  const [previousCommand, setPreviousCommand] = useState<RunnableCommand | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const initialConsumedRef = useRef(false);

  const { favorites, toggle: toggleFavorite, isFavorite } = useCommandFavorites();

  if (initialCommand && !initialConsumedRef.current) {
    initialConsumedRef.current = true;
    onConsumedInitialCommand?.();
  }

  const handleSearchQueryChange = useCallback((query: string) => {
    setSearchQuery(query);
    setFocusedIndex(0);
  }, []);

  const setSelectedCommand = useCallback(
    (command: RunnableCommand | null) => {
      setUserSelectedCommand(command);
      if (command && !initialConsumedRef.current) {
        initialConsumedRef.current = true;
        onConsumedInitialCommand?.();
      }
    },
    [onConsumedInitialCommand]
  );
  const setSelectedWorkspace = setUserSelectedWorkspace;

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
    [selectableItems, focusedIndex, onClearRun, setSelectedCommand, setSelectedWorkspace]
  );

  // Separate running/recent runs
  const runningProcesses = useMemo(() => runs.filter((r) => isActiveRun(r.status)), [runs]);
  const recentRuns = useMemo(() => runs.filter((r) => !isActiveRun(r.status)).slice(0, 10), [runs]);

  return {
    searchQuery,
    setSearchQuery: handleSearchQueryChange,
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
