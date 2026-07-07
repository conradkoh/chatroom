'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { getFileName } from '@/lib/pathUtils';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileTab {
  /** Relative file path (unique key) */
  filePath: string;
  /** Display name (file name only) */
  name: string;
  /** Whether this tab is pinned (double-click) vs preview (single-click, italic) */
  isPinned: boolean;
}

export type RightPaneViewType = 'preview' | 'table';

export interface RightPaneTab {
  /** Unique key: `${filePath}::${viewType}` */
  key: string;
  /** Source file path */
  filePath: string;
  /** Display name with suffix */
  name: string;
  /** What kind of view */
  viewType: RightPaneViewType;
}

export interface UseFileTabsOptions {
  chatroomId?: string;
}

interface FileTabsPersistedState {
  tabs: FileTab[];
  activeTabPath: string | null;
  expandedTabPath: string | null;
  rightTabs: RightPaneTab[];
  activeRightTabKey: string | null;
}

const defaultPersistedState: FileTabsPersistedState = {
  tabs: [],
  activeTabPath: null,
  expandedTabPath: null,
  rightTabs: [],
  activeRightTabKey: null,
};

function getStorageKey(chatroomId: string | undefined): string {
  return `fileTabs:${chatroomId ?? 'global'}`;
}

function parseFileTabs(raw: unknown): FileTab[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is FileTab => {
    if (!item || typeof item !== 'object') return false;
    const t = item as Record<string, unknown>;
    return (
      typeof t.filePath === 'string' &&
      typeof t.name === 'string' &&
      typeof t.isPinned === 'boolean'
    );
  });
}

function parseRightTabs(raw: unknown): RightPaneTab[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is RightPaneTab => {
    if (!item || typeof item !== 'object') return false;
    const t = item as Record<string, unknown>;
    return (
      typeof t.key === 'string' &&
      typeof t.filePath === 'string' &&
      typeof t.name === 'string' &&
      (t.viewType === 'preview' || t.viewType === 'table')
    );
  });
}

function sanitizePersistedState(state: FileTabsPersistedState): FileTabsPersistedState {
  const tabPaths = new Set(state.tabs.map((t) => t.filePath));
  let { activeTabPath, expandedTabPath, activeRightTabKey } = state;

  if (activeTabPath !== null && !tabPaths.has(activeTabPath)) {
    activeTabPath = state.tabs.length > 0 ? state.tabs[0].filePath : null;
  }
  if (expandedTabPath !== null && !tabPaths.has(expandedTabPath)) {
    expandedTabPath = null;
  }

  const rightKeys = new Set(state.rightTabs.map((t) => t.key));
  if (activeRightTabKey !== null && !rightKeys.has(activeRightTabKey)) {
    activeRightTabKey = state.rightTabs.length > 0 ? state.rightTabs[0].key : null;
  }

  return { ...state, activeTabPath, expandedTabPath, activeRightTabKey };
}

function readSavedState(storageKey: string): FileTabsPersistedState {
  if (typeof window === 'undefined') return { ...defaultPersistedState };

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { ...defaultPersistedState };
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (!data || typeof data !== 'object') return { ...defaultPersistedState };

    const activeTabPath = typeof data.activeTabPath === 'string' ? data.activeTabPath : null;
    const expandedTabPath = typeof data.expandedTabPath === 'string' ? data.expandedTabPath : null;
    const activeRightTabKey =
      typeof data.activeRightTabKey === 'string' ? data.activeRightTabKey : null;

    return sanitizePersistedState({
      tabs: parseFileTabs(data.tabs),
      activeTabPath,
      expandedTabPath,
      rightTabs: parseRightTabs(data.rightTabs),
      activeRightTabKey,
    });
  } catch {
    return { ...defaultPersistedState };
  }
}

function writeSavedState(storageKey: string, state: FileTabsPersistedState): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Quota, private mode, or SSR guard
  }
}

export interface UseFileTabsReturn {
  // Left pane
  tabs: FileTab[];
  activeTabPath: string | null;
  expandedTabPath: string | null;
  openPreview: (filePath: string) => void;
  pinTab: (filePath: string) => void;
  closeTab: (filePath: string) => void;
  closeOtherTabs: (filePath: string) => void;
  setActiveTab: (filePath: string) => void;
  toggleExpanded: (filePath: string) => void;
  renamePath: (oldPath: string, newPath: string) => void;
  // Right pane
  rightTabs: RightPaneTab[];
  activeRightTabKey: string | null;
  openRight: (filePath: string, viewType: RightPaneViewType) => void;
  closeRight: (key: string) => void;
  setActiveRightTab: (key: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rightTabKey(filePath: string, viewType: RightPaneViewType): string {
  return `${filePath}::${viewType}`;
}

function rightTabName(filePath: string, viewType: RightPaneViewType): string {
  const name = getFileName(filePath);
  return viewType === 'preview' ? `${name} (Preview)` : `${name} (Table)`;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useFileTabs(options?: UseFileTabsOptions): UseFileTabsReturn {
  const chatroomId = options?.chatroomId;
  const storageKey = getStorageKey(chatroomId);

  // Track which storage key was used for the current state to prevent cross-contamination
  const lastStorageKeyRef = useRef<string>(storageKey);

  // Synchronous restore on mount so the first persist cycle never writes empty state.
  const [tabs, setTabs] = useState<FileTab[]>(() => readSavedState(storageKey).tabs);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(
    () => readSavedState(storageKey).activeTabPath
  );
  const [expandedTabPath, setExpandedTabPath] = useState<string | null>(
    () => readSavedState(storageKey).expandedTabPath
  );

  // Right pane state
  const [rightTabs, setRightTabs] = useState<RightPaneTab[]>(
    () => readSavedState(storageKey).rightTabs
  );
  const [activeRightTabKey, setActiveRightTabKey] = useState<string | null>(
    () => readSavedState(storageKey).activeRightTabKey
  );

  /** Skip one persist cycle after the restore effect applies (chatroom switch). */
  const skipNextPersistRef = useRef(false);

  // Restore state from localStorage when storage key changes (chatroom switch)
  useEffect(() => {
    if (lastStorageKeyRef.current === storageKey) return;

    const saved = readSavedState(storageKey);
    setTabs(saved.tabs);
    setActiveTabPath(saved.activeTabPath);
    setExpandedTabPath(saved.expandedTabPath);
    setRightTabs(saved.rightTabs);
    setActiveRightTabKey(saved.activeRightTabKey);
    lastStorageKeyRef.current = storageKey;
    skipNextPersistRef.current = true;
  }, [storageKey]);

  // Persist state to localStorage when it changes
  useEffect(() => {
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    if (lastStorageKeyRef.current !== storageKey) return;

    writeSavedState(storageKey, {
      tabs,
      activeTabPath,
      expandedTabPath,
      rightTabs,
      activeRightTabKey,
    });
  }, [storageKey, tabs, activeTabPath, expandedTabPath, rightTabs, activeRightTabKey]);

  // ─── Left pane ──────────────────────────────────────────────

  const openPreview = useCallback((filePath: string) => {
    setTabs((prev) => {
      const existing = prev.find((t) => t.filePath === filePath);
      if (existing) return prev;
      const withoutPreview = prev.filter((t) => t.isPinned);
      return [...withoutPreview, { filePath, name: getFileName(filePath), isPinned: false }];
    });
    setActiveTabPath(filePath);
  }, []);

  const pinTab = useCallback((filePath: string) => {
    setTabs((prev) => {
      const existing = prev.find((t) => t.filePath === filePath);
      if (existing) {
        return prev.map((t) => (t.filePath === filePath ? { ...t, isPinned: true } : t));
      }
      const withoutPreview = prev.filter((t) => t.isPinned);
      return [...withoutPreview, { filePath, name: getFileName(filePath), isPinned: true }];
    });
    setActiveTabPath(filePath);
  }, []);

  const closeTab = useCallback((filePath: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.filePath !== filePath);
      setActiveTabPath((currentActive) => {
        if (currentActive !== filePath) return currentActive;
        const idx = prev.findIndex((t) => t.filePath === filePath);
        if (next.length === 0) return null;
        return next[Math.min(idx, next.length - 1)].filePath;
      });
      return next;
    });
    setExpandedTabPath((prev) => (prev === filePath ? null : prev));
  }, []);

  const closeOtherTabs = useCallback((keepFilePath: string) => {
    setTabs((prev) => {
      const kept = prev.filter((t) => t.filePath === keepFilePath);
      if (kept.length === 0) return prev;
      setActiveTabPath(keepFilePath);
      return kept;
    });
    setExpandedTabPath((prev) => (prev === keepFilePath ? prev : null));
  }, []);

  const setActive = useCallback((filePath: string) => {
    setActiveTabPath(filePath);
  }, []);

  const toggleExpanded = useCallback((filePath: string) => {
    setExpandedTabPath((prev) => (prev === filePath ? null : filePath));
  }, []);

  const renamePath = useCallback((oldPath: string, newPath: string) => {
    const remapFilePath = (filePath: string): string => {
      if (filePath === oldPath) return newPath;
      if (filePath.startsWith(`${oldPath}/`)) {
        return `${newPath}${filePath.slice(oldPath.length)}`;
      }
      return filePath;
    };

    setTabs((prev) =>
      prev.map((tab) => {
        const remapped = remapFilePath(tab.filePath);
        if (remapped === tab.filePath) return tab;
        return { ...tab, filePath: remapped, name: getFileName(remapped) };
      })
    );

    setActiveTabPath((prev) => (prev ? remapFilePath(prev) : prev));
    setExpandedTabPath((prev) => (prev ? remapFilePath(prev) : prev));

    setRightTabs((prev) =>
      prev.map((tab) => {
        const remapped = remapFilePath(tab.filePath);
        if (remapped === tab.filePath) return tab;
        const key = rightTabKey(remapped, tab.viewType);
        return {
          ...tab,
          filePath: remapped,
          name: rightTabName(remapped, tab.viewType),
          key,
        };
      })
    );

    setActiveRightTabKey((prev) => {
      if (!prev) return prev;
      const separator = prev.indexOf('::');
      if (separator === -1) return prev;
      const filePath = prev.slice(0, separator);
      const viewType = prev.slice(separator + 2) as RightPaneViewType;
      const remapped = remapFilePath(filePath);
      return remapped === filePath ? prev : rightTabKey(remapped, viewType);
    });
  }, []);

  // ─── Right pane ─────────────────────────────────────────────

  const openRight = useCallback((filePath: string, viewType: RightPaneViewType) => {
    const key = rightTabKey(filePath, viewType);
    setRightTabs((prev) => {
      const existing = prev.find((t) => t.key === key);
      if (existing) return prev; // already open, just activate
      return [...prev, { key, filePath, name: rightTabName(filePath, viewType), viewType }];
    });
    setActiveRightTabKey(key);
  }, []);

  const closeRight = useCallback((key: string) => {
    setRightTabs((prev) => {
      const next = prev.filter((t) => t.key !== key);
      setActiveRightTabKey((currentActive) => {
        if (currentActive !== key) return currentActive;
        if (next.length === 0) return null;
        const idx = prev.findIndex((t) => t.key === key);
        return next[Math.min(idx, next.length - 1)].key;
      });
      return next;
    });
  }, []);

  const setActiveRight = useCallback((key: string) => {
    setActiveRightTabKey(key);
  }, []);

  return {
    // Left
    tabs,
    activeTabPath,
    expandedTabPath,
    openPreview,
    pinTab,
    closeTab,
    closeOtherTabs,
    setActiveTab: setActive,
    toggleExpanded,
    renamePath,
    // Right
    rightTabs,
    activeRightTabKey,
    openRight,
    closeRight,
    setActiveRightTab: setActiveRight,
  };
}
