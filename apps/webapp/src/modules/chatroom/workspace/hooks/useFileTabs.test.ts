import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import type { EditorTab, RightPaneTab } from './useFileTabs';
import { editorTabKey, useFileTabs } from './useFileTabs';

const CHATROOM_A = 'cr-a';
const CHATROOM_B = 'cr-b';

function fileTab(filePath: string, isPinned = true): EditorTab {
  const name = filePath.split('/').pop() ?? filePath;
  return { kind: 'file', filePath, name, isPinned };
}

function storageKey(chatroomId: string): string {
  return `fileTabs:${chatroomId}`;
}

function writePinnedTab(chatroomId: string, filePath: string): void {
  localStorage.setItem(
    storageKey(chatroomId),
    JSON.stringify({
      tabs: [fileTab(filePath)],
      activeTabKey: filePath,
      expandedTabPath: null,
      rightTabs: [],
      activeRightTabKey: null,
    })
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('useFileTabs persistence', () => {
  it('restores pinned tabs from localStorage on mount', () => {
    writePinnedTab(CHATROOM_A, 'README.md');

    const { result } = renderHook(() => useFileTabs({ chatroomId: CHATROOM_A }));

    expect(result.current.tabs).toEqual([fileTab('README.md')]);
    expect(result.current.activeTabPath).toBe('README.md');
  });

  it('does not wipe localStorage on mount when stored state exists', () => {
    writePinnedTab(CHATROOM_A, 'README.md');

    renderHook(() => useFileTabs({ chatroomId: CHATROOM_A }));

    const stored = JSON.parse(localStorage.getItem(storageKey(CHATROOM_A)) ?? '{}') as {
      tabs: EditorTab[];
    };
    expect(stored.tabs).toEqual([fileTab('README.md')]);
  });

  it('persists pinTab updates to localStorage', () => {
    const { result } = renderHook(() => useFileTabs({ chatroomId: CHATROOM_A }));

    act(() => {
      result.current.pinTab('package.json');
    });

    const stored = JSON.parse(localStorage.getItem(storageKey(CHATROOM_A)) ?? '{}') as {
      tabs: EditorTab[];
      activeTabKey: string;
    };
    expect(stored.tabs).toEqual([fileTab('package.json')]);
    expect(stored.activeTabKey).toBe('package.json');
  });

  it('isolates tab state between chatrooms on switch', () => {
    writePinnedTab(CHATROOM_A, 'a.ts');
    writePinnedTab(CHATROOM_B, 'b.ts');

    const { result, rerender } = renderHook(({ chatroomId }) => useFileTabs({ chatroomId }), {
      initialProps: { chatroomId: CHATROOM_A },
    });

    expect(result.current.activeTabPath).toBe('a.ts');

    rerender({ chatroomId: CHATROOM_B });

    expect(result.current.activeTabPath).toBe('b.ts');
    const tab0 = result.current.tabs[0];
    expect(tab0?.kind === 'file' ? tab0.filePath : '').toBe('b.ts');

    const storedA = JSON.parse(localStorage.getItem(storageKey(CHATROOM_A)) ?? '{}') as {
      activeTabKey: string;
    };
    const storedB = JSON.parse(localStorage.getItem(storageKey(CHATROOM_B)) ?? '{}') as {
      activeTabKey: string;
    };
    expect(storedA.activeTabKey).toBe('a.ts');
    expect(storedB.activeTabKey).toBe('b.ts');
  });
});

describe('useFileTabs expand pane', () => {
  it('toggleExpanded sets expandedPane to editor', () => {
    const { result } = renderHook(() => useFileTabs({ chatroomId: CHATROOM_A }));

    act(() => {
      result.current.pinTab('a.ts');
      result.current.toggleExpanded('a.ts');
    });

    expect(result.current.expandedTabPath).toBe('a.ts');
    expect(result.current.expandedPane).toBe('editor');
  });

  it('togglePreviewExpanded sets expandedPane to preview', () => {
    const { result } = renderHook(() => useFileTabs({ chatroomId: CHATROOM_A }));

    act(() => {
      result.current.pinTab('a.ts');
      result.current.togglePreviewExpanded('a.ts');
    });

    expect(result.current.expandedTabPath).toBe('a.ts');
    expect(result.current.expandedPane).toBe('preview');
  });

  it('toggling preview expand again clears expand state', () => {
    const { result } = renderHook(() => useFileTabs({ chatroomId: CHATROOM_A }));

    act(() => {
      result.current.pinTab('a.ts');
      result.current.togglePreviewExpanded('a.ts');
    });

    act(() => {
      result.current.togglePreviewExpanded('a.ts');
    });

    expect(result.current.expandedTabPath).toBeNull();
    expect(result.current.expandedPane).toBeNull();
  });

  it('switching from editor-expand to preview-expand on same file updates pane', () => {
    const { result } = renderHook(() => useFileTabs({ chatroomId: CHATROOM_A }));

    act(() => {
      result.current.pinTab('a.ts');
      result.current.toggleExpanded('a.ts');
    });

    act(() => {
      result.current.togglePreviewExpanded('a.ts');
    });

    expect(result.current.expandedTabPath).toBe('a.ts');
    expect(result.current.expandedPane).toBe('preview');
  });

  it('defaults expandedPane to editor for legacy localStorage without expandedPane', () => {
    localStorage.setItem(
      storageKey(CHATROOM_A),
      JSON.stringify({
        tabs: [fileTab('a.ts')],
        activeTabPath: 'a.ts',
        expandedTabPath: 'a.ts',
        rightTabs: [],
        activeRightTabKey: null,
      })
    );

    const { result } = renderHook(() => useFileTabs({ chatroomId: CHATROOM_A }));

    expect(result.current.expandedTabPath).toBe('a.ts');
    expect(result.current.expandedPane).toBe('editor');
  });
});

describe('useFileTabs closeOtherTabs', () => {
  it('keeps only the specified tab and sets it active', () => {
    const { result } = renderHook(() => useFileTabs({ chatroomId: CHATROOM_A }));

    act(() => {
      result.current.pinTab('a.ts');
      result.current.pinTab('b.ts');
      result.current.pinTab('c.ts');
    });

    act(() => {
      result.current.closeOtherTabs('b.ts');
    });

    expect(result.current.tabs).toEqual([fileTab('b.ts')]);
    expect(result.current.activeTabPath).toBe('b.ts');
  });

  it('clears expandedTabPath when expanded tab is closed', () => {
    const { result } = renderHook(() => useFileTabs({ chatroomId: CHATROOM_A }));

    act(() => {
      result.current.pinTab('a.ts');
      result.current.pinTab('b.ts');
      result.current.toggleExpanded('a.ts');
    });

    act(() => {
      result.current.closeOtherTabs('b.ts');
    });

    expect(result.current.expandedTabPath).toBeNull();
  });

  it('preserves expandedTabPath when kept tab is expanded', () => {
    const { result } = renderHook(() => useFileTabs({ chatroomId: CHATROOM_A }));

    act(() => {
      result.current.pinTab('a.ts');
      result.current.pinTab('b.ts');
      result.current.toggleExpanded('b.ts');
    });

    act(() => {
      result.current.closeOtherTabs('b.ts');
    });

    expect(result.current.expandedTabPath).toBe('b.ts');
  });

  it('no-ops when keep path is not open', () => {
    const { result } = renderHook(() => useFileTabs({ chatroomId: CHATROOM_A }));

    act(() => {
      result.current.pinTab('a.ts');
    });

    act(() => {
      result.current.closeOtherTabs('missing.ts');
    });

    expect(result.current.tabs).toEqual([fileTab('a.ts')]);
    expect(result.current.activeTabPath).toBe('a.ts');
  });
});

describe('editorTabKey', () => {
  it('uses file path for file tabs and agentic prefix for query tabs', () => {
    expect(editorTabKey(fileTab('src/a.ts'))).toBe('src/a.ts');
    expect(
      editorTabKey({
        kind: 'agentic-query',
        queryId: 'query-1',
        name: 'Agentic Search',
        mode: 'search',
        isPinned: true,
      })
    ).toBe('agentic-query:query-1');
  });
});

describe('useFileTabs agentic query tabs', () => {
  it('openAgenticQueryTab adds a pinned tab and activates it', () => {
    const { result } = renderHook(() => useFileTabs({ chatroomId: CHATROOM_A }));

    act(() => {
      result.current.openAgenticQueryTab('query-1', 'search', 'Agentic Search');
    });

    expect(result.current.tabs).toEqual([
      {
        kind: 'agentic-query',
        queryId: 'query-1',
        name: 'Agentic Search',
        mode: 'search',
        isPinned: true,
      },
    ]);
    expect(result.current.activeTabKey).toBe('agentic-query:query-1');
  });

  it('openAgenticQueryTab replaces unpinned file tabs but keeps pinned tabs', () => {
    const { result } = renderHook(() => useFileTabs({ chatroomId: CHATROOM_A }));

    act(() => {
      result.current.pinTab('pinned.ts');
      result.current.openPreview('preview.ts');
      result.current.openAgenticQueryTab('query-2', 'ask');
    });

    expect(result.current.tabs).toEqual([
      fileTab('pinned.ts'),
      {
        kind: 'agentic-query',
        queryId: 'query-2',
        name: 'Agentic Ask',
        mode: 'ask',
        isPinned: true,
      },
    ]);
    expect(result.current.activeTabKey).toBe('agentic-query:query-2');
  });

  it('closeAgenticQueryTab removes the agentic tab', () => {
    const { result } = renderHook(() => useFileTabs({ chatroomId: CHATROOM_A }));

    act(() => {
      result.current.openAgenticQueryTab('query-3', 'search');
      result.current.closeAgenticQueryTab('query-3');
    });

    expect(result.current.tabs).toEqual([]);
    expect(result.current.activeTabKey).toBeNull();
  });

  it('persists agentic tabs to localStorage', () => {
    const { result } = renderHook(() => useFileTabs({ chatroomId: CHATROOM_A }));

    act(() => {
      result.current.openAgenticQueryTab('query-4', 'search', 'Agentic Search');
    });

    const stored = JSON.parse(localStorage.getItem(storageKey(CHATROOM_A)) ?? '{}') as {
      tabs: EditorTab[];
      activeTabKey: string;
    };
    expect(stored.tabs[0]).toMatchObject({
      kind: 'agentic-query',
      queryId: 'query-4',
      mode: 'search',
    });
    expect(stored.activeTabKey).toBe('agentic-query:query-4');
  });

  it('keeps existing agentic tabs when opening another concurrent search session', () => {
    const { result } = renderHook(() => useFileTabs({ chatroomId: CHATROOM_A }));

    act(() => {
      result.current.openAgenticQueryTab('query-a', 'search', 'Agentic Search');
      result.current.openAgenticQueryTab('query-b', 'search', 'Agentic Search');
    });

    expect(result.current.tabs).toEqual([
      {
        kind: 'agentic-query',
        queryId: 'query-a',
        name: 'Agentic Search',
        mode: 'search',
        isPinned: true,
      },
      {
        kind: 'agentic-query',
        queryId: 'query-b',
        name: 'Agentic Search',
        mode: 'search',
        isPinned: true,
      },
    ]);
    expect(result.current.activeTabKey).toBe('agentic-query:query-b');
  });

  it('ignores openAgenticQueryTab when queryId is empty', () => {
    const { result } = renderHook(() => useFileTabs({ chatroomId: CHATROOM_A }));

    act(() => {
      result.current.openAgenticQueryTab('', 'search', 'Agentic Search');
    });

    expect(result.current.tabs).toEqual([]);
    expect(result.current.activeTabKey).toBeNull();
  });

  it('drops invalid agentic-query tabs and dedupes duplicate keys from localStorage', () => {
    localStorage.setItem(
      storageKey(CHATROOM_A),
      JSON.stringify({
        tabs: [
          {
            kind: 'agentic-query',
            queryId: 'query-1',
            name: 'Agentic Search',
            mode: 'search',
            isPinned: true,
          },
          {
            kind: 'agentic-query',
            name: 'Broken',
            mode: 'search',
            isPinned: true,
          },
          {
            kind: 'agentic-query',
            queryId: 'query-1',
            name: 'Duplicate',
            mode: 'search',
            isPinned: true,
          },
        ],
        activeTabKey: 'agentic-query:undefined',
      })
    );

    const { result } = renderHook(() => useFileTabs({ chatroomId: CHATROOM_A }));

    expect(result.current.tabs).toEqual([
      {
        kind: 'agentic-query',
        queryId: 'query-1',
        name: 'Duplicate',
        mode: 'search',
        isPinned: true,
      },
    ]);
    expect(result.current.activeTabKey).toBe('agentic-query:query-1');
  });
});

describe('useFileTabs navigateActivePreview', () => {
  function writeRightPreviewTab(chatroomId: string, filePath: string): void {
    localStorage.setItem(
      storageKey(chatroomId),
      JSON.stringify({
        tabs: [],
        activeTabKey: null,
        expandedTabPath: null,
        rightTabs: [
          {
            key: `${filePath}::preview`,
            filePath,
            name: `${filePath.split('/').pop()} (Preview)`,
            viewType: 'preview',
          },
        ],
        activeRightTabKey: `${filePath}::preview`,
      })
    );
  }

  function writeRightPreviewTabs(
    chatroomId: string,
    tabs: { filePath: string; active: boolean }[]
  ): void {
    const rightTabs: RightPaneTab[] = tabs.map((t) => ({
      key: `${t.filePath}::preview`,
      filePath: t.filePath,
      name: `${t.filePath.split('/').pop()} (Preview)`,
      viewType: 'preview' as const,
    }));
    const activeKey = tabs.find((t) => t.active)?.filePath ?? tabs[0].filePath;
    localStorage.setItem(
      storageKey(chatroomId),
      JSON.stringify({
        tabs: [],
        activeTabKey: null,
        expandedTabPath: null,
        rightTabs,
        activeRightTabKey: `${activeKey}::preview`,
      })
    );
  }

  it('updates existing preview tab to new file', () => {
    writeRightPreviewTab(CHATROOM_A, 'a.md');
    const { result } = renderHook(() => useFileTabs({ chatroomId: CHATROOM_A }));

    expect(result.current.rightTabs).toHaveLength(1);
    expect(result.current.rightTabs[0].filePath).toBe('a.md');

    act(() => {
      result.current.navigateActivePreview('b.md');
    });

    expect(result.current.rightTabs).toHaveLength(1);
    expect(result.current.rightTabs[0].filePath).toBe('b.md');
    expect(result.current.rightTabs[0].key).toBe('b.md::preview');
    expect(result.current.activeRightTabKey).toBe('b.md::preview');
  });

  it('is no-op when no preview tabs exist', () => {
    const { result } = renderHook(() => useFileTabs({ chatroomId: CHATROOM_A }));

    expect(result.current.rightTabs).toHaveLength(0);

    act(() => {
      result.current.navigateActivePreview('b.md');
    });

    expect(result.current.rightTabs).toHaveLength(0);
    expect(result.current.activeRightTabKey).toBeNull();
  });

  it('replaces active preview tab when multiple preview tabs exist', () => {
    writeRightPreviewTabs(CHATROOM_A, [
      { filePath: 'a.md', active: false },
      { filePath: 'b.md', active: true },
    ]);
    const { result } = renderHook(() => useFileTabs({ chatroomId: CHATROOM_A }));

    expect(result.current.rightTabs).toHaveLength(2);
    expect(result.current.activeRightTabKey).toBe('b.md::preview');

    act(() => {
      result.current.navigateActivePreview('c.md');
    });

    // Still 2 tabs, but the active one (b) is now c
    expect(result.current.rightTabs).toHaveLength(2);
    const cTab = result.current.rightTabs.find((t) => t.filePath === 'c.md');
    expect(cTab).toBeDefined();
    expect(result.current.activeRightTabKey).toBe('c.md::preview');
    // a.md tab unchanged
    expect(result.current.rightTabs.find((t) => t.filePath === 'a.md')).toBeDefined();
  });

  it('activates existing tab if new file already has one', () => {
    writeRightPreviewTabs(CHATROOM_A, [
      { filePath: 'a.md', active: true },
      { filePath: 'b.md', active: false },
    ]);
    const { result } = renderHook(() => useFileTabs({ chatroomId: CHATROOM_A }));

    expect(result.current.activeRightTabKey).toBe('a.md::preview');

    act(() => {
      result.current.navigateActivePreview('b.md');
    });

    // Tabs unchanged, just re-activated
    expect(result.current.rightTabs).toHaveLength(2);
    expect(result.current.activeRightTabKey).toBe('b.md::preview');
  });
});
