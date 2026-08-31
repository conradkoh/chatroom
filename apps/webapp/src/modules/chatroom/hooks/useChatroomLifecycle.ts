'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import type { ActivityView } from '../components/ActivityBar';
import { useActivityView } from './persistence/useActivityView';
import { useExplorerSplitViewEnabled } from './persistence/useExplorerSplitViewEnabled';
import { useExplorerSyncPreference } from './persistence/useExplorerSyncPreference';
import type { ChatroomActiveWorkspace } from './useChatroomActiveWorkspace';
import { useChatroomActiveWorkspace } from './useChatroomActiveWorkspace';
import type { Workspace } from '../types/workspace';
import { useFileTabs } from '../workspace/hooks/useFileTabs';
import type { UseFileTabsReturn } from '../workspace/hooks/useFileTabs';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Full return type of the chatroom lifecycle coordinator hook. */
export interface UseChatroomLifecycleReturn {
  /** File tab state (left pane tabs + right pane tabs). */
  fileTabs: UseFileTabsReturn;
  /** Currently-active workspace (null if none connected). */
  activeWorkspace: ChatroomActiveWorkspace | null;
  /** All workspaces for the chatroom (including unconnected). */
  workspaces: Workspace[];
  /** Current activity view, persisted per chatroom. */
  activityView: ActivityView;
  /** Setter for the activity view. */
  setActivityView: (view: ActivityView) => void;
  /** Whether the explorer-split chat panel is open, persisted per chatroom. */
  explorerSplitViewEnabled: boolean;
  /** Setter for explorer-split chat panel visibility. */
  setExplorerSplitViewEnabled: (enabled: boolean) => void;
  /** Whether Explorer↔active-editor sync is enabled, persisted per chatroom. */
  explorerSyncEnabled: boolean;
  /** Setter for Explorer↔active-editor sync preference. */
  setExplorerSyncEnabled: (enabled: boolean) => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Thin coordinator hook that composes the per-chatroom persistence hooks into a
 * single state object for ChatroomDashboard.
 *
 * Persistence is still **owned** by the individual hooks — this layer only
 * composes their return values.
 */
export function useChatroomLifecycle(chatroomId: Id<'chatroom_rooms'>): UseChatroomLifecycleReturn {
  const fileTabs = useFileTabs({ chatroomId: chatroomId as string });
  const { activeWorkspace, workspaces } = useChatroomActiveWorkspace(chatroomId);
  const [activityView, setActivityView] = useActivityView(chatroomId);
  const [explorerSplitViewEnabled, setExplorerSplitViewEnabled] =
    useExplorerSplitViewEnabled(chatroomId);
  const [explorerSyncEnabled, setExplorerSyncEnabled] = useExplorerSyncPreference(chatroomId);

  return {
    fileTabs,
    activeWorkspace,
    workspaces,
    activityView,
    setActivityView,
    explorerSplitViewEnabled,
    setExplorerSplitViewEnabled,
    explorerSyncEnabled,
    setExplorerSyncEnabled,
  };
}
