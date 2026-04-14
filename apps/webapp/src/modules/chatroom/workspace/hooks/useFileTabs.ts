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

function readSavedState(storageKey: string): FileTabsPersistedState {
  if (typeof window === 'undefined') return { ...defaultPersistedState };

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { ...defaultPersistedState };
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (!data || typeof data !== 'object') return { ...defaultPersistedState };

    const activeTabPath =
      typeof data.activeTabPath === 'string' ? data.activeTabPath : null;
    const expandedTabPath =
      typeof data.expandedTabPath === 'string' ? data.expandedTabPath : null;
    const activeRightTabKey =
      typeof data.activeRightTabKey === 'string' ? data.activeRightTabKey : null;

    return {
      tabs: parseFileTabs(data.tabs),
      activeTabPath,
      expandedTabPath,
      rightTabs: parseRightTabs(data.rightTabs),
      activeRightTabKey,
    };
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
  setActiveTab: (filePath: string) => void;
  toggleExpanded: (filePath: string) => void;
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

  // Left pane state
  const [tabs, setTabs] = useState<FileTab[]>(
    () => readSavedState(getStorageKey(chatroomId)).tabs
  );
  const [activeTabPath, setActiveTabPath] = useState<string | null>(
    () => readSavedState(getStorageKey(chatroomId)).activeTabPath
  );
  const [expandedTabPath, setExpandedTabPath] = useState<string | null>(
    () => readSavedState(getStorageKey(chatroomId)).expandedTabPath
  );

  // Right pane state
  const [rightTabs, setRightTabs] = useState<RightPaneTab[]>(
    () => readSavedState(getStorageKey(chatroomId)).rightTabs
  );
  const [activeRightTabKey, setActiveRightTabKey] = useState<string | null>(
    () => readSavedState(getStorageKey(chatroomId)).activeRightTabKey
  );

  /** Avoid writing stale tab state to a new storage key before restore applies. */
  const skipPersistAfterStorageKeyChange = useRef(false);

  useEffect(() => {
    const saved = readSavedState(storageKey);
    setTabs(saved.tabs);
    setActiveTabPath(saved.activeTabPath);
    setExpandedTabPath(saved.expandedTabPath);
    setRightTabs(saved.rightTabs);
    setActiveRightTabKey(saved.activeRightTabKey);
    skipPersistAfterStorageKeyChange.current = true;
  }, [storageKey]);

  useEffect(() => {
    if (skipPersistAfterStorageKeyChange.current) {
      skipPersistAfterStorageKeyChange.current = false;
      return;
    }
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

  const setActive = useCallback((filePath: string) => {
    setActiveTabPath(filePath);
  }, []);

  const toggleExpanded = useCallback((filePath: string) => {
    setExpandedTabPath((prev) => (prev === filePath ? null : filePath));
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
    setActiveTab: setActive,
    toggleExpanded,
    // Right
    rightTabs,
    activeRightTabKey,
    openRight,
    closeRight,
    setActiveRightTab: setActiveRight,
  };
}
