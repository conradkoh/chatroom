import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';

import { useExplorerSplitViewEnabled } from './useExplorerSplitViewEnabled';

const CHATROOM_A = 'cr-a' as never;
const CHATROOM_B = 'cr-b' as never;

beforeEach(() => {
  localStorage.clear();
});

describe('useExplorerSplitViewEnabled', () => {
  it('defaults to false when nothing is stored', () => {
    const { result } = renderHook(() => useExplorerSplitViewEnabled(CHATROOM_A));
    expect(result.current[0]).toBe(false);
  });

  it('reads true from localStorage', () => {
    localStorage.setItem('chatroom:cr-a:explorerSplitViewEnabled', JSON.stringify(true));
    const { result } = renderHook(() => useExplorerSplitViewEnabled(CHATROOM_A));
    expect(result.current[0]).toBe(true);
  });

  it('setter persists to localStorage and updates state', () => {
    const { result } = renderHook(() => useExplorerSplitViewEnabled(CHATROOM_A));
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem('chatroom:cr-a:explorerSplitViewEnabled')).toBe('true');
  });

  it('isolates between chatrooms', () => {
    localStorage.setItem('chatroom:cr-a:explorerSplitViewEnabled', JSON.stringify(true));
    localStorage.setItem('chatroom:cr-b:explorerSplitViewEnabled', JSON.stringify(false));

    const { result: rA } = renderHook(() => useExplorerSplitViewEnabled(CHATROOM_A));
    const { result: rB } = renderHook(() => useExplorerSplitViewEnabled(CHATROOM_B));

    expect(rA.current[0]).toBe(true);
    expect(rB.current[0]).toBe(false);
  });
});
