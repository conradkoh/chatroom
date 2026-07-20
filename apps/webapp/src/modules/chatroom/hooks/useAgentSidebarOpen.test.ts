import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useAgentSidebarOpen } from './useAgentSidebarOpen';

const CHATROOM_ID = 'cr-test-room';
const STORAGE_KEY = `chatroom:${CHATROOM_ID}:agentSidebarVisible`;

beforeEach(() => {
  localStorage.clear();
});

describe('useAgentSidebarOpen', () => {
  it('desktop: defaults to visible', () => {
    const { result } = renderHook(() => useAgentSidebarOpen(false));
    expect(result.current.visible).toBe(true);
  });

  it('mobile: defaults to hidden', () => {
    const { result } = renderHook(() => useAgentSidebarOpen(true));
    expect(result.current.visible).toBe(false);
  });

  it('desktop: setVisible(false) hides; setVisible(true) shows', () => {
    const { result } = renderHook(() => useAgentSidebarOpen(false));
    act(() => result.current.setVisible(false));
    expect(result.current.visible).toBe(false);
    act(() => result.current.setVisible(true));
    expect(result.current.visible).toBe(true);
  });

  it('mobile: setVisible(true) shows sidebar in session', () => {
    const { result } = renderHook(() => useAgentSidebarOpen(true));
    act(() => result.current.setVisible(true));
    expect(result.current.visible).toBe(true);
  });

  it('desktop: restoreDesktopDefault always shows sidebar after focus mode', () => {
    const { result } = renderHook(() => useAgentSidebarOpen(false));
    act(() => result.current.setVisible(false));
    expect(result.current.visible).toBe(false);
    act(() => result.current.restoreDesktopDefault());
    expect(result.current.visible).toBe(true);
  });

  it('does not read or write localStorage (ignores stale persisted false)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(false));
    const { result } = renderHook(() => useAgentSidebarOpen(false));
    expect(result.current.visible).toBe(true);
    act(() => result.current.setVisible(false));
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(false)); // stale value unchanged — hook never writes
    act(() => result.current.setVisible(true));
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(false));
  });

  it('hydration guard: undefined isSmallScreen yields hidden until resolved', () => {
    const { result } = renderHook(() => useAgentSidebarOpen(undefined));
    expect(result.current.visible).toBe(false);
  });
});
