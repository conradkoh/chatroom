'use client';

import { useState, useEffect, useMemo } from 'react';

import type { Workspace, WorkspaceGroup } from '../types/workspace';

/** Sentinel value for the "All Workspaces" option. */
export const ALL_WORKSPACES = '__all__';

export interface UseWorkspaceSelectionResult {
  /** Currently selected workspace ID, or ALL_WORKSPACES. */
  selectedWorkspaceId: string;
  /** Update the selected workspace. */
  setSelectedWorkspaceId: (id: string) => void;
  /** Flat list of all workspaces across all groups. */
  flatWorkspaces: Workspace[];
  /** The selected workspace object, or null when "All" is selected. */
  selectedWorkspace: Workspace | null;
  /** Workspace groups filtered to the selected workspace (or all groups if "All"). */
  filteredGroups: WorkspaceGroup[];
}

/**
 * Manages workspace selection state with stale-reset behavior.
 *
 * Shared between Settings > Workspaces (AgentSettingsModal) and the
 * All Agents modal (UnifiedAgentListModal) to eliminate duplicated
 * selection + filtering + stale-reset logic.
 */
export function useWorkspaceSelection(
  workspaceGroups: WorkspaceGroup[]
): UseWorkspaceSelectionResult {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(ALL_WORKSPACES);

  // Flat list for selection lookup (includes unassigned)
  const flatWorkspaces = useMemo(
    () => workspaceGroups.flatMap((g) => g.workspaces),
    [workspaceGroups]
  );

  // Reset selection to "all" if current selection becomes stale
  useEffect(() => {
    if (
      selectedWorkspaceId !== ALL_WORKSPACES &&
      !flatWorkspaces.find((w) => w.id === selectedWorkspaceId)
    ) {
      setSelectedWorkspaceId(ALL_WORKSPACES);
    }
  }, [flatWorkspaces, selectedWorkspaceId]);

  // Resolve the selected workspace (null when "All" is selected)
  const selectedWorkspace = useMemo(
    () =>
      selectedWorkspaceId === ALL_WORKSPACES
        ? null
        : (flatWorkspaces.find((w) => w.id === selectedWorkspaceId) ?? null),
    [flatWorkspaces, selectedWorkspaceId]
  );

  // Filter workspace groups based on selection
  const filteredGroups = useMemo((): WorkspaceGroup[] => {
    if (selectedWorkspaceId === ALL_WORKSPACES) return workspaceGroups;
    for (const group of workspaceGroups) {
      const ws = group.workspaces.find((w) => w.id === selectedWorkspaceId);
      if (ws) {
        return [{ ...group, workspaces: [ws] }];
      }
    }
    return workspaceGroups; // fallback to all if selection is stale
  }, [workspaceGroups, selectedWorkspaceId]);

  return {
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    flatWorkspaces,
    selectedWorkspace,
    filteredGroups,
  };
}
