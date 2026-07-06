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
