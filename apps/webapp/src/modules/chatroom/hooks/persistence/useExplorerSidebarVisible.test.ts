import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';

import { useExplorerSidebarVisible } from './useExplorerSidebarVisible';

const CHATROOM_A = 'cr-a' as never;
const CHATROOM_B = 'cr-b' as never;

beforeEach(() => {
  localStorage.clear();
});

describe('useExplorerSidebarVisible', () => {
  it('defaults to true when nothing is stored', () => {
    const { result } = renderHook(() => useExplorerSidebarVisible(CHATROOM_A));
    expect(result.current[0]).toBe(true);
  });

  it('reads false from localStorage', () => {
    localStorage.setItem('chatroom:cr-a:explorerSidebarVisible', JSON.stringify(false));
    const { result } = renderHook(() => useExplorerSidebarVisible(CHATROOM_A));
    expect(result.current[0]).toBe(false);
  });

  it('setter persists to localStorage and updates state', () => {
    const { result } = renderHook(() => useExplorerSidebarVisible(CHATROOM_A));
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(localStorage.getItem('chatroom:cr-a:explorerSidebarVisible')).toBe('false');
  });

  it('isolates between chatrooms', () => {
    localStorage.setItem('chatroom:cr-a:explorerSidebarVisible', JSON.stringify(true));
    localStorage.setItem('chatroom:cr-b:explorerSidebarVisible', JSON.stringify(false));

    const { result: rA } = renderHook(() => useExplorerSidebarVisible(CHATROOM_A));
    const { result: rB } = renderHook(() => useExplorerSidebarVisible(CHATROOM_B));

    expect(rA.current[0]).toBe(true);
    expect(rB.current[0]).toBe(false);
  });
});
