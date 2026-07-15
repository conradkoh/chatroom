'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ExpandPane } from '../utils/editorExpandLayout';

import { getFileName } from '@/lib/pathUtils';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgenticQueryMode = 'search' | 'ask';

export type EditorTab =
  | { kind: 'file'; filePath: string; name: string; isPinned: boolean }
  | {
      kind: 'agentic-query';
      queryId: string;
      name: string;
      mode: AgenticQueryMode;
      isPinned: boolean;
    };

export function editorTabKey(tab: EditorTab): string {
  return tab.kind === 'file' ? tab.filePath : `agentic-query:${tab.queryId}`;
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

interface ExpandState {
  filePath: string;
  pane: ExpandPane;
}

interface FileTabsPersistedState {
  tabs: EditorTab[];
  activeTabKey: string | null;
  expandedTabPath: string | null;
  expandedPane: ExpandPane | null;
  rightTabs: RightPaneTab[];
  activeRightTabKey: string | null;
}

const defaultPersistedState: FileTabsPersistedState = {
  tabs: [],
  activeTabKey: null,
  expandedTabPath: null,
  expandedPane: null,
  rightTabs: [],
  activeRightTabKey: null,
};

function getStorageKey(chatroomId: string | undefined): string {
  return `fileTabs:${chatroomId ?? 'global'}`;
}

function parseEditorTabs(raw: unknown): EditorTab[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is EditorTab => {
    if (!item || typeof item !== 'object') return false;
    const t = item as Record<string, unknown>;
    if (t.kind === 'agentic-query') {
      return (
        typeof t.queryId === 'string' &&
        typeof t.name === 'string' &&
        (t.mode === 'search' || t.mode === 'ask') &&
        typeof t.isPinned === 'boolean'
      );
    }
    // Default: treat as file tab (backward compat with saved FileTab[])
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

function normalizeTab(t: EditorTab): EditorTab {
  if (t.kind === 'file') {
    return { ...t, name: t.name || getFileName(t.filePath) };
  }
  return t;
}

function expandStateFromSaved(saved: FileTabsPersistedState): ExpandState | null {
  if (!saved.expandedTabPath) return null;
  return {
    filePath: saved.expandedTabPath,
    pane: saved.expandedPane ?? 'editor',
  };
}

function sanitizePersistedState(state: FileTabsPersistedState): FileTabsPersistedState {
  const tabKeys = new Set(state.tabs.map(editorTabKey));
  let { activeTabKey, expandedTabPath, expandedPane, activeRightTabKey } = state;

  if (activeTabKey !== null && !tabKeys.has(activeTabKey)) {
    activeTabKey = state.tabs.length > 0 ? editorTabKey(state.tabs[0]) : null;
  }
  if (expandedTabPath !== null && !tabKeys.has(expandedTabPath)) {
    expandedTabPath = null;
    expandedPane = null;
  }
  if (expandedTabPath === null) {
    expandedPane = null;
  }

  const rightKeys = new Set(state.rightTabs.map((t) => t.key));
  if (activeRightTabKey !== null && !rightKeys.has(activeRightTabKey)) {
    activeRightTabKey = state.rightTabs.length > 0 ? state.rightTabs[0].key : null;
  }

  return { ...state, activeTabKey, expandedTabPath, expandedPane, activeRightTabKey };
}

function readSavedState(storageKey: string): FileTabsPersistedState {
  if (typeof window === 'undefined') return { ...defaultPersistedState };

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { ...defaultPersistedState };
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (!data || typeof data !== 'object') return { ...defaultPersistedState };

    // Backward compat: try activeTabKey first, then activeTabPath
    const activeTabKey =
      typeof data.activeTabKey === 'string'
        ? data.activeTabKey
        : typeof data.activeTabPath === 'string'
          ? data.activeTabPath
          : null;
    const expandedTabPath = typeof data.expandedTabPath === 'string' ? data.expandedTabPath : null;
    const expandedPane =
      data.expandedPane === 'editor' || data.expandedPane === 'preview'
        ? data.expandedPane
        : expandedTabPath !== null
          ? 'editor'
          : null;
    const activeRightTabKey =
      typeof data.activeRightTabKey === 'string' ? data.activeRightTabKey : null;

    return sanitizePersistedState({
      tabs: parseEditorTabs(data.tabs).map(normalizeTab),
      activeTabKey,
      expandedTabPath,
      expandedPane,
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

// ─── Public return type ───────────────────────────────────────────────────────

export interface UseFileTabsReturn {
  tabs: EditorTab[];
  activeTabKey: string | null;
  activeTabPath: string | null;
  expandedTabPath: string | null;
  expandedPane: ExpandPane | null;
  openPreview: (filePath: string) => void;
  pinTab: (filePath: string) => void;
  closeTab: (key: string) => void;
  closeOtherTabs: (key: string) => void;
  setActiveTab: (key: string) => void;
  toggleExpanded: (filePath: string) => void;
  togglePreviewExpanded: (filePath: string) => void;
  renamePath: (oldPath: string, newPath: string) => void;
  openAgenticQueryTab: (queryId: string, mode: AgenticQueryMode, name?: string) => void;
  closeAgenticQueryTab: (queryId: string) => void;
  // Right pane
  rightTabs: RightPaneTab[];
  activeRightTabKey: string | null;
  openRight: (filePath: string, viewType: RightPaneViewType) => void;
  closeRight: (key: string) => void;
  setActiveRightTab: (key: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function activeFilePath(tabs: EditorTab[], activeTabKey: string | null): string | null {
  if (!activeTabKey) return null;
  const tab = tabs.find((t) => editorTabKey(t) === activeTabKey);
  if (tab?.kind === 'file') return tab.filePath;
  return null;
}

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

  const lastStorageKeyRef = useRef<string>(storageKey);

  const [tabs, setTabs] = useState<EditorTab[]>(() => readSavedState(storageKey).tabs);
  const [activeTabKey, setActiveTabKey] = useState<string | null>(
    () => readSavedState(storageKey).activeTabKey
  );
  const [expandState, setExpandState] = useState<ExpandState | null>(() =>
    expandStateFromSaved(readSavedState(storageKey))
  );

  const [rightTabs, setRightTabs] = useState<RightPaneTab[]>(
    () => readSavedState(storageKey).rightTabs
  );
  const [activeRightTabKey, setActiveRightTabKey] = useState<string | null>(
    () => readSavedState(storageKey).activeRightTabKey
  );

  const skipNextPersistRef = useRef(false);

  useEffect(() => {
    if (lastStorageKeyRef.current === storageKey) return;

    const saved = readSavedState(storageKey);
    setTabs(saved.tabs);
    setActiveTabKey(saved.activeTabKey);
    setExpandState(expandStateFromSaved(saved));
    setRightTabs(saved.rightTabs);
    setActiveRightTabKey(saved.activeRightTabKey);
    lastStorageKeyRef.current = storageKey;
    skipNextPersistRef.current = true;
  }, [storageKey]);

  useEffect(() => {
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    if (lastStorageKeyRef.current !== storageKey) return;

    writeSavedState(storageKey, {
      tabs,
      activeTabKey,
      expandedTabPath: expandState?.filePath ?? null,
      expandedPane: expandState?.pane ?? null,
      rightTabs,
      activeRightTabKey,
    });
  }, [storageKey, tabs, activeTabKey, expandState, rightTabs, activeRightTabKey]);

  // ─── Left pane ──────────────────────────────────────────────

  const openPreview = useCallback((filePath: string) => {
    setTabs((prev) => {
      const existing = prev.find((t) => t.kind === 'file' && t.filePath === filePath) as
        | EditorTab
        | undefined;
      if (existing) return prev;
      const withoutPreview = prev.filter((t) => t.isPinned);
      return [
        ...withoutPreview,
        { kind: 'file' as const, filePath, name: getFileName(filePath), isPinned: false },
      ];
    });
    setActiveTabKey(filePath);
  }, []);

  const pinTab = useCallback((filePath: string) => {
    setTabs((prev) => {
      const existing = prev.find((t) => t.kind === 'file' && t.filePath === filePath) as
        | EditorTab
        | undefined;
      if (existing) {
        return prev.map((t) =>
          t.kind === 'file' && t.filePath === filePath ? { ...t, isPinned: true } : t
        );
      }
      const withoutPreview = prev.filter((t) => t.isPinned);
      return [
        ...withoutPreview,
        { kind: 'file' as const, filePath, name: getFileName(filePath), isPinned: true },
      ];
    });
    setActiveTabKey(filePath);
  }, []);

  const closeTab = useCallback(
    (key: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => editorTabKey(t) !== key);
        setActiveTabKey((currentActive) => {
          if (currentActive !== key) return currentActive;
          const idx = prev.findIndex((t) => editorTabKey(t) === key);
          if (next.length === 0) return null;
          return editorTabKey(next[Math.min(idx, next.length - 1)]);
        });
        return next;
      });
      setExpandState((prev) => {
        const tab = prev
          ? tabs.find((t) => t.kind === 'file' && t.filePath === prev.filePath)
          : undefined;
        return prev && !tab ? null : prev;
      });
    },
    [tabs]
  );

  const closeOtherTabs = useCallback(
    (key: string) => {
      setTabs((prev) => {
        const kept = prev.filter((t) => editorTabKey(t) === key);
        if (kept.length === 0) return prev;
        setActiveTabKey(key);
        return kept;
      });
      setExpandState((prev) => {
        const tab = prev
          ? tabs.find((t) => t.kind === 'file' && t.filePath === prev.filePath)
          : undefined;
        return prev && !tab ? null : prev;
      });
    },
    [tabs]
  );

  const setActive = useCallback((key: string) => {
    setActiveTabKey(key);
  }, []);

  const toggleExpanded = useCallback((filePath: string) => {
    setExpandState((prev) =>
      prev?.filePath === filePath && prev?.pane === 'editor' ? null : { filePath, pane: 'editor' }
    );
  }, []);

  const togglePreviewExpanded = useCallback((filePath: string) => {
    setExpandState((prev) =>
      prev?.filePath === filePath && prev?.pane === 'preview' ? null : { filePath, pane: 'preview' }
    );
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
        if (tab.kind !== 'file') return tab;
        const remapped = remapFilePath(tab.filePath);
        if (remapped === tab.filePath) return tab;
        return { ...tab, filePath: remapped, name: getFileName(remapped) };
      })
    );

    setActiveTabKey((prev) => (prev ? remapFilePath(prev) : prev));
    setExpandState((prev) => {
      if (!prev) return prev;
      const remapped = remapFilePath(prev.filePath);
      return remapped === prev.filePath ? prev : { ...prev, filePath: remapped };
    });

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

  const openAgenticQueryTab = useCallback(
    (queryId: string, mode: AgenticQueryMode, name?: string) => {
      const key = `agentic-query:${queryId}`;
      setTabs((prev) => {
        const existing = prev.find((t) => t.kind === 'agentic-query' && t.queryId === queryId) as
          | EditorTab
          | undefined;
        if (existing) return prev;
        const withoutPreview = prev.filter((t) => t.isPinned);
        return [
          ...withoutPreview,
          {
            kind: 'agentic-query' as const,
            queryId,
            name: name ?? (mode === 'search' ? 'Agentic Search' : 'Agentic Ask'),
            mode,
            isPinned: true,
          },
        ];
      });
      setActiveTabKey(key);
    },
    []
  );

  const closeAgenticQueryTab = useCallback(
    (queryId: string) => {
      const key = `agentic-query:${queryId}`;
      closeTab(key);
    },
    [closeTab]
  );

  // ─── Right pane ─────────────────────────────────────────────

  const openRight = useCallback((filePath: string, viewType: RightPaneViewType) => {
    const key = rightTabKey(filePath, viewType);
    setRightTabs((prev) => {
      const existing = prev.find((t) => t.key === key);
      if (existing) return prev;
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

  const computedActiveTabPath = activeFilePath(tabs, activeTabKey);

  return {
    tabs,
    activeTabKey,
    activeTabPath: computedActiveTabPath,
    expandedTabPath: expandState?.filePath ?? null,
    expandedPane: expandState?.pane ?? null,
    openPreview,
    pinTab,
    closeTab,
    closeOtherTabs,
    setActiveTab: setActive,
    toggleExpanded,
    togglePreviewExpanded,
    renamePath,
    openAgenticQueryTab,
    closeAgenticQueryTab,
    rightTabs,
    activeRightTabKey,
    openRight,
    closeRight,
    setActiveRightTab: setActiveRight,
  };
}
