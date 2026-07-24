'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SplitDropSide } from '../components/EditorSplitDropOverlay';
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
    }
  | { kind: 'preview'; filePath: string; name: string; isPinned: boolean }
  | { kind: 'table'; filePath: string; name: string; isPinned: boolean };

export type RightPaneViewType = 'preview' | 'table';

function rightTabKey(filePath: string, viewType: RightPaneViewType): string {
  return `${filePath}::${viewType}`;
}

function rightTabName(filePath: string, viewType: RightPaneViewType): string {
  const name = getFileName(filePath);
  return viewType === 'preview' ? `${name} (Preview)` : `${name} (Table)`;
}

export function editorTabKey(tab: EditorTab): string {
  if (tab.kind === 'file') return tab.filePath;
  if (tab.kind === 'agentic-query') return `agentic-query:${tab.queryId}`;
  return rightTabKey(tab.filePath, tab.kind);
}

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

export function isViewTabKey(key: string): boolean {
  return key.endsWith('::preview') || key.endsWith('::table');
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

const FILE_TABS_PERSIST_DEBOUNCE_MS = 300;

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
    if (t.kind === 'preview' || t.kind === 'table') {
      return (
        typeof t.filePath === 'string' &&
        typeof t.name === 'string' &&
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
  if (tab.kind === 'preview' || tab.kind === 'table') {
    return typeof tab.filePath === 'string' && tab.filePath.length > 0;
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
  if (t.kind === 'preview' || t.kind === 'table') {
    return { ...t, name: t.name || rightTabName(t.filePath, t.kind) };
  }
  return t;
}

// fallow-ignore-next-line complexity
function migrateRightTabsToEditorTabs(state: FileTabsPersistedState): FileTabsPersistedState {
  const { rightTabs } = state;
  if (rightTabs.length === 0) return state;

  const tabs = [...state.tabs];
  const secondaryKeys = new Set(state.editorSplit?.secondaryTabKeys);

  for (const rt of rightTabs) {
    secondaryKeys.add(rt.key);
    if (tabs.every((t) => editorTabKey(t) !== rt.key)) {
      tabs.push({ kind: rt.viewType, filePath: rt.filePath, name: rt.name, isPinned: true });
    }
  }

  const secondaryTabKeys = [...secondaryKeys];
  const activeSecondaryTabKey =
    [state.activeRightTabKey, state.editorSplit?.activeSecondaryTabKey, secondaryTabKeys[0]].find(
      (key) => key != null && secondaryKeys.has(key)
    ) ?? null;

  return {
    ...state,
    tabs,
    rightTabs: [],
    activeRightTabKey: null,
    editorSplit: { enabled: true, secondaryTabKeys, activeSecondaryTabKey },
  };
}

function expandStateFromSaved(saved: FileTabsPersistedState): ExpandState | null {
  if (!saved.expandedTabPath) return null;
  return {
    filePath: saved.expandedTabPath,
    pane: saved.expandedPane ?? 'editor',
  };
}

function sanitizePersistedState(state: FileTabsPersistedState): FileTabsPersistedState {
  const migrated = migrateRightTabsToEditorTabs(state);
  const tabs = dedupeTabsByKey(migrated.tabs.filter(isValidEditorTab));
  const tabKeys = new Set(tabs.map(editorTabKey));
  let { activeTabKey, expandedTabPath, expandedPane, activeRightTabKey } = migrated;

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

  const rightKeys = new Set(migrated.rightTabs.map((t) => t.key));
  if (activeRightTabKey !== null && !rightKeys.has(activeRightTabKey)) {
    activeRightTabKey = migrated.rightTabs.length > 0 ? migrated.rightTabs[0].key : null;
  }

  const editorSplit = sanitizeEditorSplit(migrated.editorSplit, tabKeys);

  return {
    ...migrated,
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
  setActiveSecondaryTab: (tabKey: string) => void;
  closeSecondarySplit: () => void;
  handleEditorSplitDrop: (tabKey: string, side: SplitDropSide) => void;
  editorSplitLayoutEpoch: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function activeFilePath(tabs: EditorTab[], activeTabKey: string | null): string | null {
  if (!activeTabKey) return null;
  const tab = tabs.find((t) => editorTabKey(t) === activeTabKey);
  if (tab?.kind === 'file') return tab.filePath;
  return null;
}

function viewTabsFromEditorTabs(tabs: EditorTab[]): RightPaneTab[] {
  return tabs
    .filter(
      (t): t is Extract<EditorTab, { kind: 'preview' | 'table' }> =>
        t.kind === 'preview' || t.kind === 'table'
    )
    .map((t) => ({
      key: editorTabKey(t),
      filePath: t.filePath,
      name: t.name,
      viewType: t.kind,
    }));
}

function findFileTab(
  tabs: EditorTab[],
  filePath: string
): Extract<EditorTab, { kind: 'file' }> | undefined {
  const tab = tabs.find((t) => t.kind === 'file' && t.filePath === filePath);
  return tab?.kind === 'file' ? tab : undefined;
}

// ─── Editor Split Drop ────────────────────────────────────────────────────────

// fallow-ignore-next-line unused-export
export function computeEditorSplitDrop(params: {
  tabKey: string;
  side: SplitDropSide;
  activeTabKey: string | null;
  editorSplit: EditorSplitState | null;
  tabKeysInOrder: string[];
}): { nextActiveTabKey: string | null; nextEditorSplit: EditorSplitState | null } {
  const { tabKey, side, activeTabKey, editorSplit, tabKeysInOrder } = params;
  const wasInSecondary = editorSplit?.secondaryTabKeys.includes(tabKey) ?? false;

  if (side === 'right') {
    let secondaryTabKeys: string[];
    if (wasInSecondary) {
      secondaryTabKeys = editorSplit?.secondaryTabKeys ?? [tabKey];
    } else {
      secondaryTabKeys = [...(editorSplit?.secondaryTabKeys ?? []), tabKey];
    }

    let nextActiveTabKey = activeTabKey;
    let finalSecondaryTabKeys = secondaryTabKeys;

    if (activeTabKey === tabKey) {
      const primaryCandidate = tabKeysInOrder.find(
        (k) => k !== tabKey && !secondaryTabKeys.includes(k)
      );
      if (primaryCandidate) {
        nextActiveTabKey = primaryCandidate;
      } else if (editorSplit?.enabled) {
        // Primary pane would be empty — swap: promote active secondary tab to primary
        const promoteKey =
          editorSplit.activeSecondaryTabKey && editorSplit.activeSecondaryTabKey !== tabKey
            ? editorSplit.activeSecondaryTabKey
            : secondaryTabKeys.find((k) => k !== tabKey);
        if (promoteKey) {
          nextActiveTabKey = promoteKey;
          finalSecondaryTabKeys = secondaryTabKeys.filter((k) => k !== promoteKey);
        } else {
          nextActiveTabKey = null;
        }
      } else {
        nextActiveTabKey = null;
      }
    }

    const nextEditorSplit: EditorSplitState = {
      enabled: true,
      secondaryTabKeys: finalSecondaryTabKeys,
      activeSecondaryTabKey: tabKey,
    };
    return { nextActiveTabKey, nextEditorSplit };
  }

  // side === 'left'
  if (!editorSplit?.enabled) {
    const nextEditorSplit: EditorSplitState | null =
      activeTabKey && activeTabKey !== tabKey
        ? {
            enabled: true,
            secondaryTabKeys: [activeTabKey],
            activeSecondaryTabKey: activeTabKey,
          }
        : null;
    return { nextActiveTabKey: tabKey, nextEditorSplit };
  }

  const secondaryTabKeys = editorSplit.secondaryTabKeys.filter((k) => k !== tabKey);
  if (secondaryTabKeys.length === 0) {
    return { nextActiveTabKey: tabKey, nextEditorSplit: null };
  }
  const activeSecondaryTabKey =
    editorSplit.activeSecondaryTabKey === tabKey
      ? secondaryTabKeys[0]
      : editorSplit.activeSecondaryTabKey;
  return {
    nextActiveTabKey: tabKey,
    nextEditorSplit: { enabled: true, secondaryTabKeys, activeSecondaryTabKey },
  };
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

  const [editorSplit, setEditorSplit] = useState<EditorSplitState | null>(
    () => readSavedState(storageKey).editorSplit
  );
  const [editorSplitLayoutEpoch, setEditorSplitLayoutEpoch] = useState(0);

  const skipNextPersistRef = useRef(false);

  useEffect(() => {
    if (lastStorageKeyRef.current === storageKey) return;

    const saved = readSavedState(storageKey);
    setTabs(saved.tabs);
    setActiveTabKey(saved.activeTabKey);
    setExpandState(expandStateFromSaved(saved));
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

    const timer = setTimeout(writeSavedState, FILE_TABS_PERSIST_DEBOUNCE_MS, storageKey, {
      tabs,
      activeTabKey,
      expandedTabPath: expandState?.filePath ?? null,
      expandedPane: expandState?.pane ?? null,
      rightTabs: [],
      activeRightTabKey: null,
      editorSplit,
    });

    return () => clearTimeout(timer);
  }, [storageKey, tabs, activeTabKey, expandState, editorSplit]);

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
        if (tab.kind !== 'file' && tab.kind !== 'preview' && tab.kind !== 'table') return tab;
        const remapped = remapFilePath(tab.filePath);
        if (remapped === tab.filePath) return tab;
        if (tab.kind === 'file') {
          return { ...tab, filePath: remapped, name: getFileName(remapped) };
        }
        return {
          ...tab,
          filePath: remapped,
          name: rightTabName(remapped, tab.kind),
        };
      })
    );

    setActiveTabKey((prev) => {
      if (!prev) return prev;
      if (isViewTabKey(prev)) {
        const separator = prev.indexOf('::');
        const filePath = prev.slice(0, separator);
        const viewType = prev.slice(separator + 2) as RightPaneViewType;
        const remapped = remapFilePath(filePath);
        return remapped === filePath ? prev : rightTabKey(remapped, viewType);
      }
      return remapFilePath(prev);
    });
    setExpandState((prev) => {
      if (!prev) return prev;
      const remapped = remapFilePath(prev.filePath);
      return remapped === prev.filePath ? prev : { ...prev, filePath: remapped };
    });

    setEditorSplit((prev) => {
      if (!prev) return prev;
      const secondaryTabKeys = prev.secondaryTabKeys.map((key) => {
        if (!isViewTabKey(key)) return remapFilePath(key);
        const separator = key.indexOf('::');
        const filePath = key.slice(0, separator);
        const viewType = key.slice(separator + 2) as RightPaneViewType;
        const remapped = remapFilePath(filePath);
        return remapped === filePath ? key : rightTabKey(remapped, viewType);
      });
      const activeSecondaryTabKey = prev.activeSecondaryTabKey
        ? (secondaryTabKeys[prev.secondaryTabKeys.indexOf(prev.activeSecondaryTabKey)] ??
          secondaryTabKeys[0] ??
          null)
        : null;
      return { ...prev, secondaryTabKeys, activeSecondaryTabKey };
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
    const viewKey = rightTabKey(filePath, viewType);
    const sourceKey = filePath;

    setTabs((prev) => {
      if (prev.some((t) => editorTabKey(t) === viewKey)) return prev;
      return [
        ...prev,
        {
          kind: viewType,
          filePath,
          name: rightTabName(filePath, viewType),
          isPinned: true,
        },
      ];
    });

    setEditorSplit((prev) => {
      const withoutSource = (prev?.secondaryTabKeys ?? []).filter((k) => k !== sourceKey);
      const secondaryTabKeys = withoutSource.includes(viewKey)
        ? withoutSource
        : [...withoutSource, viewKey];
      return {
        enabled: true,
        secondaryTabKeys,
        activeSecondaryTabKey: viewKey,
      };
    });

    setActiveTabKey(sourceKey);
  }, []);

  const closeRight = useCallback(
    (key: string) => {
      closeTab(key);
    },
    [closeTab]
  );

  const setActiveRight = useCallback((key: string) => {
    setEditorSplit((prev) => {
      if (!prev?.secondaryTabKeys.includes(key)) return prev;
      return { ...prev, activeSecondaryTabKey: key };
    });
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

  const setActiveSecondaryTab = useCallback((tabKey: string) => {
    setEditorSplit((prev) => {
      if (!prev?.secondaryTabKeys.includes(tabKey)) return prev;
      return { ...prev, activeSecondaryTabKey: tabKey };
    });
  }, []);

  const closeSecondarySplit = useCallback(() => {
    setEditorSplit(null);
  }, []);

  const handleEditorSplitDrop = useCallback(
    (tabKey: string, side: SplitDropSide) => {
      const tabKeysInOrder = tabs.map((t) => editorTabKey(t));
      const { nextActiveTabKey, nextEditorSplit } = computeEditorSplitDrop({
        tabKey,
        side,
        activeTabKey,
        editorSplit: editorSplit?.enabled ? editorSplit : null,
        tabKeysInOrder,
      });
      setEditorSplit(nextEditorSplit);
      if (nextActiveTabKey != null) setActiveTabKey(nextActiveTabKey);
      setEditorSplitLayoutEpoch((e) => e + 1);
    },
    [tabs, activeTabKey, editorSplit, setActiveTabKey, setEditorSplit]
  );

  const navigateActivePreview = useCallback(
    (filePath: string) => {
      const newKey = rightTabKey(filePath, 'preview');
      const previewTabs = tabs.filter((t) => t.kind === 'preview');
      if (previewTabs.length === 0) return;

      if (tabs.some((t) => editorTabKey(t) === newKey)) {
        setEditorSplit((split) =>
          split?.secondaryTabKeys.includes(newKey)
            ? { ...split, activeSecondaryTabKey: newKey }
            : split
        );
        return;
      }

      const targetKey =
        editorSplit?.activeSecondaryTabKey &&
        previewTabs.some((t) => editorTabKey(t) === editorSplit.activeSecondaryTabKey)
          ? editorSplit.activeSecondaryTabKey
          : editorTabKey(previewTabs[0]);

      setTabs((prev) =>
        prev.map((t) =>
          editorTabKey(t) === targetKey
            ? {
                kind: 'preview' as const,
                filePath,
                name: rightTabName(filePath, 'preview'),
                isPinned: true,
              }
            : t
        )
      );

      setEditorSplit((split) => {
        if (!split) return split;
        return {
          ...split,
          secondaryTabKeys: split.secondaryTabKeys.map((k) => (k === targetKey ? newKey : k)),
          activeSecondaryTabKey:
            split.activeSecondaryTabKey === targetKey ? newKey : split.activeSecondaryTabKey,
        };
      });
    },
    [tabs, editorSplit?.activeSecondaryTabKey]
  );

  const computedActiveTabPath = activeFilePath(tabs, activeTabKey);
  const derivedRightTabs = useMemo(() => viewTabsFromEditorTabs(tabs), [tabs]);
  const derivedActiveRightTabKey = useMemo(() => {
    if (editorSplit?.activeSecondaryTabKey && isViewTabKey(editorSplit.activeSecondaryTabKey)) {
      return editorSplit.activeSecondaryTabKey;
    }
    return null;
  }, [editorSplit?.activeSecondaryTabKey]);

  return useMemo(
    () => ({
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
      rightTabs: derivedRightTabs,
      activeRightTabKey: derivedActiveRightTabKey,
      openRight,
      closeRight,
      setActiveRightTab: setActiveRight,
      navigateActivePreview,
      editorSplit,
      moveTabToSecondaryPane,
      moveTabToPrimaryPane,
      setActiveSecondaryTab,
      closeSecondarySplit,
      handleEditorSplitDrop,
      editorSplitLayoutEpoch,
    }),
    [
      tabs,
      activeTabKey,
      computedActiveTabPath,
      expandState?.filePath,
      expandState?.pane,
      openPreview,
      pinTab,
      closeTab,
      closeOtherTabs,
      setActive,
      toggleExpanded,
      togglePreviewExpanded,
      renamePath,
      openAgenticQueryTab,
      closeAgenticQueryTab,
      derivedRightTabs,
      derivedActiveRightTabKey,
      openRight,
      closeRight,
      setActiveRight,
      navigateActivePreview,
      editorSplit,
      moveTabToSecondaryPane,
      moveTabToPrimaryPane,
      setActiveSecondaryTab,
      closeSecondarySplit,
      handleEditorSplitDrop,
      editorSplitLayoutEpoch,
    ]
  );
}
