import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useFileTabs } from './useFileTabs';

const CHATROOM_A = 'cr-a';
const CHATROOM_B = 'cr-b';

function storageKey(chatroomId: string): string {
  return `fileTabs:${chatroomId}`;
}

function writePinnedTab(chatroomId: string, filePath: string): void {
  localStorage.setItem(
    storageKey(chatroomId),
    JSON.stringify({
      tabs: [{ filePath, name: 'README.md', isPinned: true }],
      activeTabPath: filePath,
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

    expect(result.current.tabs).toEqual([
      { filePath: 'README.md', name: 'README.md', isPinned: true },
    ]);
    expect(result.current.activeTabPath).toBe('README.md');
  });

  it('does not wipe localStorage on mount when stored state exists', () => {
    writePinnedTab(CHATROOM_A, 'README.md');

    renderHook(() => useFileTabs({ chatroomId: CHATROOM_A }));

    const stored = JSON.parse(localStorage.getItem(storageKey(CHATROOM_A)) ?? '{}') as {
      tabs: { filePath: string; isPinned: boolean }[];
    };
    expect(stored.tabs).toEqual([{ filePath: 'README.md', name: 'README.md', isPinned: true }]);
  });

  it('persists pinTab updates to localStorage', () => {
    const { result } = renderHook(() => useFileTabs({ chatroomId: CHATROOM_A }));

    act(() => {
      result.current.pinTab('package.json');
    });

    const stored = JSON.parse(localStorage.getItem(storageKey(CHATROOM_A)) ?? '{}') as {
      tabs: { filePath: string; isPinned: boolean }[];
      activeTabPath: string;
    };
    expect(stored.tabs).toEqual([
      { filePath: 'package.json', name: 'package.json', isPinned: true },
    ]);
    expect(stored.activeTabPath).toBe('package.json');
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
    expect(result.current.tabs[0]?.filePath).toBe('b.ts');

    const storedA = JSON.parse(localStorage.getItem(storageKey(CHATROOM_A)) ?? '{}') as {
      activeTabPath: string;
    };
    const storedB = JSON.parse(localStorage.getItem(storageKey(CHATROOM_B)) ?? '{}') as {
      activeTabPath: string;
    };
    expect(storedA.activeTabPath).toBe('a.ts');
    expect(storedB.activeTabPath).toBe('b.ts');
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
        tabs: [{ filePath: 'a.ts', name: 'a.ts', isPinned: true }],
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

    expect(result.current.tabs).toEqual([{ filePath: 'b.ts', name: 'b.ts', isPinned: true }]);
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

    expect(result.current.tabs).toEqual([{ filePath: 'a.ts', name: 'a.ts', isPinned: true }]);
    expect(result.current.activeTabPath).toBe('a.ts');
  });
});
