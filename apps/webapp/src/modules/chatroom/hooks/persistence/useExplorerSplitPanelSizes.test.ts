import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';

import { useExplorerSplitPanelSizes } from './useExplorerSplitPanelSizes';

const CHATROOM_A = 'cr-a' as never;
const CHATROOM_B = 'cr-b' as never;

beforeEach(() => {
  localStorage.clear();
});

describe('useExplorerSplitPanelSizes', () => {
  it('defaults to [55, 45] when nothing is stored', () => {
    const { result } = renderHook(() => useExplorerSplitPanelSizes(CHATROOM_A));
    expect(result.current[0]).toEqual([55, 45]);
  });

  it('reads stored sizes from localStorage', () => {
    localStorage.setItem('chatroom:cr-a:explorerSplitSizes', JSON.stringify([40, 60]));
    const { result } = renderHook(() => useExplorerSplitPanelSizes(CHATROOM_A));
    expect(result.current[0]).toEqual([40, 60]);
  });

  it('setter persists to localStorage and updates state', () => {
    const { result } = renderHook(() => useExplorerSplitPanelSizes(CHATROOM_A));
    act(() => result.current[1]([35, 65]));
    expect(result.current[0]).toEqual([35, 65]);
    expect(localStorage.getItem('chatroom:cr-a:explorerSplitSizes')).toBe('[35,65]');
  });

  it('isolates between chatrooms', () => {
    localStorage.setItem('chatroom:cr-a:explorerSplitSizes', JSON.stringify([50, 50]));
    localStorage.setItem('chatroom:cr-b:explorerSplitSizes', JSON.stringify([70, 30]));

    const { result: rA } = renderHook(() => useExplorerSplitPanelSizes(CHATROOM_A));
    const { result: rB } = renderHook(() => useExplorerSplitPanelSizes(CHATROOM_B));

    expect(rA.current[0]).toEqual([50, 50]);
    expect(rB.current[0]).toEqual([70, 30]);
  });

  it('restores sizes after remount', () => {
    const { result, unmount } = renderHook(() => useExplorerSplitPanelSizes(CHATROOM_A));
    act(() => result.current[1]([42, 58]));
    unmount();

    const { result: remounted } = renderHook(() => useExplorerSplitPanelSizes(CHATROOM_A));
    expect(remounted.current[0]).toEqual([42, 58]);
  });
});
