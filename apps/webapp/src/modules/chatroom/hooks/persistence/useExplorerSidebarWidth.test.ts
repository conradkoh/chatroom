import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';

import { useExplorerSidebarWidth } from './useExplorerSidebarWidth';

const DEFAULT_WIDTH_PX = 256;

const CHATROOM_A = 'cr-a' as never;
const CHATROOM_B = 'cr-b' as never;

beforeEach(() => {
  localStorage.clear();
});

describe('useExplorerSidebarWidth', () => {
  it('defaults to 256px when nothing is stored', () => {
    const { result } = renderHook(() => useExplorerSidebarWidth(CHATROOM_A));
    expect(result.current[0]).toBe(DEFAULT_WIDTH_PX);
  });

  it('reads stored width from localStorage', () => {
    localStorage.setItem('chatroom:cr-a:explorerSidebarWidth', JSON.stringify(320));
    const { result } = renderHook(() => useExplorerSidebarWidth(CHATROOM_A));
    expect(result.current[0]).toBe(320);
  });

  it('falls back to default for invalid stored values', () => {
    localStorage.setItem('chatroom:cr-a:explorerSidebarWidth', JSON.stringify(999));
    const { result } = renderHook(() => useExplorerSidebarWidth(CHATROOM_A));
    expect(result.current[0]).toBe(DEFAULT_WIDTH_PX);
  });

  it('setter persists to localStorage and updates state', () => {
    const { result } = renderHook(() => useExplorerSidebarWidth(CHATROOM_A));
    act(() => result.current[1](300));
    expect(result.current[0]).toBe(300);
    expect(localStorage.getItem('chatroom:cr-a:explorerSidebarWidth')).toBe('300');
  });

  it('isolates between chatrooms', () => {
    localStorage.setItem('chatroom:cr-a:explorerSidebarWidth', JSON.stringify(280));
    localStorage.setItem('chatroom:cr-b:explorerSidebarWidth', JSON.stringify(360));

    const { result: rA } = renderHook(() => useExplorerSidebarWidth(CHATROOM_A));
    const { result: rB } = renderHook(() => useExplorerSidebarWidth(CHATROOM_B));

    expect(rA.current[0]).toBe(280);
    expect(rB.current[0]).toBe(360);
  });
});
