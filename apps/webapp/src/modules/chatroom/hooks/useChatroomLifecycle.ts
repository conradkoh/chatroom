'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import { useChatroomActiveWorkspace } from './useChatroomActiveWorkspace';
import type { ChatroomActiveWorkspace } from './useChatroomActiveWorkspace';
import { useExplorerSplitViewEnabled } from './useExplorerSplitViewEnabled';
import { usePersistedState } from './usePersistedState';
import type { ActivityView } from '../components/ActivityBar';
import { useExplorerSplitPanelMode } from '../explorer-split-panels/useExplorerSplitPanelMode';
import type { ExplorerSplitPanelMode } from '../explorer-split-panels/useExplorerSplitPanelMode';
import type { Workspace } from '../types/workspace';
import { useFileTabs } from '../workspace/hooks/useFileTabs';
import type { UseFileTabsReturn } from '../workspace/hooks/useFileTabs';

// ─── localStorage keys ─────────────────────────────────────────────────────────

const ACTIVITY_VIEW_KEY = (chatroomId: string) => `chatroom:${chatroomId}:activityView`;

const HARNESS_SESSION_KEY = (chatroomId: string) =>
  `chatroom:${chatroomId}:harnessPanel:selectedSessionId`;

// ─── Validators ────────────────────────────────────────────────────────────────

const isValidActivityView = (v: unknown): v is ActivityView =>
  v === 'messages' || v === 'explorer' || v === 'direct-harness';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Full return type of the chatroom lifecycle coordinator hook. */
export interface UseChatroomLifecycleReturn {
  /** File tab state (left pane tabs + right pane tabs). */
  fileTabs: UseFileTabsReturn;
  /** Current right-split-panel mode ('messages' | 'direct-harness'). */
  splitMode: ExplorerSplitPanelMode;
  /** Setter for the right-split-panel mode. */
  setSplitMode: (mode: ExplorerSplitPanelMode) => void;
  /** Currently-active workspace (null if none connected). */
  activeWorkspace: ChatroomActiveWorkspace | null;
  /** All workspaces for the chatroom (including unconnected). */
  workspaces: Workspace[];
  /** Current activity view ('messages' | 'explorer' | 'direct-harness'), persisted per chatroom. */
  activityView: ActivityView;
  /** Setter for the activity view. */
  setActivityView: (view: ActivityView) => void;
  /** Selected direct-harness session ID (null = "new session"), persisted per chatroom. */
  selectedHarnessSessionId: string | null;
  /** Setter for the selected harness session ID. */
  setSelectedHarnessSessionId: (id: string | null) => void;
  /** Whether the explorer-split chat panel is open, persisted per chatroom. */
  explorerSplitViewEnabled: boolean;
  /** Setter for explorer-split chat panel visibility. */
  setExplorerSplitViewEnabled: (enabled: boolean) => void;
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
  const [splitMode, setSplitMode] = useExplorerSplitPanelMode(chatroomId);
  const { activeWorkspace, workspaces } = useChatroomActiveWorkspace(chatroomId);

  const activityViewKey = ACTIVITY_VIEW_KEY(chatroomId as string);
  const [activityView, setActivityView] = usePersistedState<ActivityView>(
    activityViewKey,
    'messages',
    { validate: isValidActivityView }
  );

  const harnessSessionKey = HARNESS_SESSION_KEY(chatroomId as string);
  const [selectedHarnessSessionId, setSelectedHarnessSessionId] = usePersistedState<string | null>(
    harnessSessionKey,
    null
  );

  const [explorerSplitViewEnabled, setExplorerSplitViewEnabled] =
    useExplorerSplitViewEnabled(chatroomId);

  return {
    fileTabs,
    splitMode,
    setSplitMode,
    activeWorkspace,
    workspaces,
    activityView,
    setActivityView,
    selectedHarnessSessionId,
    setSelectedHarnessSessionId,
    explorerSplitViewEnabled,
    setExplorerSplitViewEnabled,
  };
}
