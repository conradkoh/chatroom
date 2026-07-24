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

export interface EditorSplitState {
  enabled: boolean;
  /** Tab keys assigned to secondary (right) pane; primary = all other file tabs */
  secondaryTabKeys: string[];
  activeSecondaryTabKey: string | null;
}

interface FileTabsPersistedState {
  tabs: EditorTab[];
  activeTabKey: string | null;
  expandedTabPath: string | null;
  expandedPane: ExpandPane | null;
  rightTabs: RightPaneTab[];
  activeRightTabKey: string | null;
  editorSplit: EditorSplitState | null;
}

const defaultPersistedState: FileTabsPersistedState = {
  tabs: [],
  activeTabKey: null,
  expandedTabPath: null,
  expandedPane: null,
  rightTabs: [],
  activeRightTabKey: null,
  editorSplit: null,
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
        isValidAgenticQueryId(t.queryId) &&
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

function isValidAgenticQueryId(queryId: unknown): queryId is string {
  return typeof queryId === 'string' && queryId.length > 0;
}

function isValidEditorTab(tab: EditorTab): boolean {
  if (tab.kind === 'agentic-query') {
    return isValidAgenticQueryId(tab.queryId);
  }
  return typeof tab.filePath === 'string' && tab.filePath.length > 0;
}

function dedupeTabsByKey(tabs: EditorTab[]): EditorTab[] {
  const seen = new Set<string>();
  const deduped: EditorTab[] = [];

  for (let i = tabs.length - 1; i >= 0; i--) {
    const tab = tabs[i];
    const key = editorTabKey(tab);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.unshift(tab);
  }

  return deduped;
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
  const tabs = dedupeTabsByKey(state.tabs.filter(isValidEditorTab));
  const tabKeys = new Set(tabs.map(editorTabKey));
  let { activeTabKey, expandedTabPath, expandedPane, activeRightTabKey } = state;

  if (activeTabKey !== null && !tabKeys.has(activeTabKey)) {
    activeTabKey = tabs.length > 0 ? editorTabKey(tabs[0]) : null;
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

  const editorSplit = sanitizeEditorSplit(state.editorSplit, tabKeys);

  return {
    ...state,
    tabs,
    activeTabKey,
    expandedTabPath,
    expandedPane,
    activeRightTabKey,
    editorSplit,
  };
}

function sanitizeEditorSplit(
  split: EditorSplitState | null | undefined,
  tabKeys: Set<string>
): EditorSplitState | null {
  if (!split || !split.enabled) return null;
  const secondaryTabKeys = split.secondaryTabKeys.filter((k) => tabKeys.has(k));
  if (secondaryTabKeys.length === 0) return null;
  const activeSecondaryTabKey =
    split.activeSecondaryTabKey && secondaryTabKeys.includes(split.activeSecondaryTabKey)
      ? split.activeSecondaryTabKey
      : secondaryTabKeys[0];
  return { enabled: true, secondaryTabKeys, activeSecondaryTabKey };
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

    const rawSplit = data.editorSplit as Record<string, unknown> | undefined;
    const editorSplit: EditorSplitState | null =
      rawSplit && typeof rawSplit === 'object'
        ? {
            enabled: true,
            secondaryTabKeys: Array.isArray(rawSplit.secondaryTabKeys)
              ? (rawSplit.secondaryTabKeys as string[]).filter((k) => typeof k === 'string')
              : [],
            activeSecondaryTabKey:
              typeof rawSplit.activeSecondaryTabKey === 'string'
                ? rawSplit.activeSecondaryTabKey
                : null,
          }
        : null;

    return sanitizePersistedState({
      tabs: parseEditorTabs(data.tabs).map(normalizeTab),
      activeTabKey,
      expandedTabPath,
      expandedPane,
      rightTabs: parseRightTabs(data.rightTabs),
      activeRightTabKey,
      editorSplit,
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
  navigateActivePreview: (filePath: string) => void;
  // Editor horizontal split
  editorSplit: EditorSplitState | null;
  moveTabToSecondaryPane: (tabKey: string) => void;
  moveTabToPrimaryPane: (tabKey: string) => void;
  closeSecondarySplit: () => void;
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

function findFileTab(
  tabs: EditorTab[],
  filePath: string
): Extract<EditorTab, { kind: 'file' }> | undefined {
  const tab = tabs.find((t) => t.kind === 'file' && t.filePath === filePath);
  return tab?.kind === 'file' ? tab : undefined;
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
  const [editorSplit, setEditorSplit] = useState<EditorSplitState | null>(
    () => readSavedState(storageKey).editorSplit
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
    setEditorSplit(saved.editorSplit);
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
      editorSplit,
    });
  }, [storageKey, tabs, activeTabKey, expandState, rightTabs, activeRightTabKey, editorSplit]);

  // ─── Left pane ──────────────────────────────────────────────

  const openPreview = useCallback((filePath: string) => {
    setTabs((prev) => {
      if (findFileTab(prev, filePath)) return prev;
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
      const existing = findFileTab(prev, filePath);
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
      // Remove from secondary pane if present
      setEditorSplit((prev) => {
        if (!prev || !prev.secondaryTabKeys.includes(key)) return prev;
        const secondaryTabKeys = prev.secondaryTabKeys.filter((k) => k !== key);
        if (secondaryTabKeys.length === 0) return null;
        const activeSecondaryTabKey =
          prev.activeSecondaryTabKey === key ? secondaryTabKeys[0] : prev.activeSecondaryTabKey;
        return { ...prev, secondaryTabKeys, activeSecondaryTabKey };
      });

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

  const closeOtherTabs = useCallback((key: string) => {
    setTabs((prev) => {
      const kept = prev.filter((t) => editorTabKey(t) === key);
      if (kept.length === 0) return prev;
      setActiveTabKey(key);
      return kept;
    });
    setExpandState((prev) => (prev?.filePath === key ? prev : null));
  }, []);

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
      if (!isValidAgenticQueryId(queryId)) return;

      const key = `agentic-query:${queryId}`;
      setTabs((prev) => {
        const existing = prev.find(
          (t): t is Extract<EditorTab, { kind: 'agentic-query' }> =>
            t.kind === 'agentic-query' && t.queryId === queryId
        );
        if (existing) {
          const nextName = name ?? existing.name;
          if (existing.mode === mode && existing.name === nextName) {
            return prev;
          }
          return prev.map((t) =>
            t.kind === 'agentic-query' && t.queryId === queryId
              ? { ...t, mode, ...(name !== undefined ? { name } : {}) }
              : t
          );
        }
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
      setActiveTabKey((current) => (current === key ? current : key));
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

  // ─── Editor Split ─────────────────────────────────────────

  const moveTabToSecondaryPane = useCallback((tabKey: string) => {
    setEditorSplit((prev) => {
      if (prev?.secondaryTabKeys.includes(tabKey)) return prev;
      const secondaryTabKeys = [...(prev?.secondaryTabKeys ?? []), tabKey];
      return {
        enabled: true,
        secondaryTabKeys,
        activeSecondaryTabKey: tabKey,
      };
    });
  }, []);

  const moveTabToPrimaryPane = useCallback((tabKey: string) => {
    setEditorSplit((prev) => {
      if (!prev) return prev;
      const secondaryTabKeys = prev.secondaryTabKeys.filter((k) => k !== tabKey);
      if (secondaryTabKeys.length === 0) return null;
      const activeSecondaryTabKey =
        prev.activeSecondaryTabKey === tabKey ? secondaryTabKeys[0] : prev.activeSecondaryTabKey;
      return { ...prev, secondaryTabKeys, activeSecondaryTabKey };
    });
  }, []);

  const closeSecondarySplit = useCallback(() => {
    setEditorSplit(null);
  }, []);

  const navigateActivePreview = useCallback(
    (filePath: string) => {
      setRightTabs((prev) => {
        const previewTabs = prev.filter((t) => t.viewType === 'preview');
        if (previewTabs.length === 0) return prev;

        const newKey = rightTabKey(filePath, 'preview');

        const existing = prev.find((t) => t.key === newKey);
        if (existing) {
          setActiveRightTabKey(newKey);
          return prev;
        }

        const target = previewTabs.find((t) => t.key === activeRightTabKey) ?? previewTabs[0];

        setActiveRightTabKey(newKey);
        return prev.map((t) =>
          t.key === target.key
            ? {
                key: newKey,
                filePath,
                name: rightTabName(filePath, 'preview'),
                viewType: 'preview' as const,
              }
            : t
        );
      });
    },
    [activeRightTabKey]
  );

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
    navigateActivePreview,
    editorSplit,
    moveTabToSecondaryPane,
    moveTabToPrimaryPane,
    closeSecondarySplit,
  };
}
