'use client';

import { useCallback, useState } from 'react';

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

export function useFileTabs(): UseFileTabsReturn {
  // Left pane state
  const [tabs, setTabs] = useState<FileTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [expandedTabPath, setExpandedTabPath] = useState<string | null>(null);

  // Right pane state
  const [rightTabs, setRightTabs] = useState<RightPaneTab[]>([]);
  const [activeRightTabKey, setActiveRightTabKey] = useState<string | null>(null);

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
