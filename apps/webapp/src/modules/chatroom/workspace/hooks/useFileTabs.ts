'use client';

import { useCallback, useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileTab {
  /** Relative file path (unique key) */
  filePath: string;
  /** Display name (file name only) */
  name: string;
  /** Whether this tab is pinned (double-click) vs preview (single-click, italic) */
  isPinned: boolean;
}

export interface UseFileTabsReturn {
  tabs: FileTab[];
  activeTabPath: string | null;
  /** Path of the expanded tab (double-click on pinned tab toggles) */
  expandedTabPath: string | null;
  /** Open a file as a preview tab (replaces existing preview tab) */
  openPreview: (filePath: string) => void;
  /** Pin a tab (double-click or double-click on tree item) */
  pinTab: (filePath: string) => void;
  /** Close a specific tab */
  closeTab: (filePath: string) => void;
  /** Set the active tab */
  setActiveTab: (filePath: string) => void;
  /** Toggle expanded state on a pinned tab */
  toggleExpanded: (filePath: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getFileName(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1] || filePath;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useFileTabs(): UseFileTabsReturn {
  const [tabs, setTabs] = useState<FileTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [expandedTabPath, setExpandedTabPath] = useState<string | null>(null);

  const openPreview = useCallback((filePath: string) => {
    setTabs((prev) => {
      // If already open, just activate it
      const existing = prev.find((t) => t.filePath === filePath);
      if (existing) {
        return prev; // don't modify — just activate below
      }

      // Replace the existing preview (non-pinned) tab, if any
      const withoutPreview = prev.filter((t) => t.isPinned);
      return [
        ...withoutPreview,
        { filePath, name: getFileName(filePath), isPinned: false },
      ];
    });
    setActiveTabPath(filePath);
  }, []);

  const pinTab = useCallback((filePath: string) => {
    setTabs((prev) => {
      const existing = prev.find((t) => t.filePath === filePath);
      if (existing) {
        // Pin the existing tab
        return prev.map((t) =>
          t.filePath === filePath ? { ...t, isPinned: true } : t
        );
      }
      // Open as pinned (replace preview tab)
      const withoutPreview = prev.filter((t) => t.isPinned);
      return [
        ...withoutPreview,
        { filePath, name: getFileName(filePath), isPinned: true },
      ];
    });
    setActiveTabPath(filePath);
  }, []);

  const closeTab = useCallback((filePath: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.filePath !== filePath);
      // Also update active tab in the same batch
      setActiveTabPath((currentActive) => {
        if (currentActive !== filePath) return currentActive;
        // Pick a neighbor: prefer the tab before, then after, then null
        const idx = prev.findIndex((t) => t.filePath === filePath);
        if (next.length === 0) return null;
        return next[Math.min(idx, next.length - 1)].filePath;
      });
      return next;
    });
  }, []);

  const setActive = useCallback((filePath: string) => {
    setActiveTabPath(filePath);
  }, []);

  const toggleExpanded = useCallback((filePath: string) => {
    setExpandedTabPath((prev) => (prev === filePath ? null : filePath));
  }, []);

  return {
    tabs,
    activeTabPath,
    expandedTabPath,
    openPreview,
    pinTab,
    closeTab,
    setActiveTab: setActive,
    toggleExpanded,
  };
}
