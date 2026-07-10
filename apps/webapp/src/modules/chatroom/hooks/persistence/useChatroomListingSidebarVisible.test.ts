import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';

import { useChatroomListingSidebarVisible } from './useChatroomListingSidebarVisible';

beforeEach(() => {
  localStorage.clear();
});

describe('useChatroomListingSidebarVisible', () => {
  it('defaults to true', () => {
    const { result } = renderHook(() => useChatroomListingSidebarVisible());
    expect(result.current[0]).toBe(true);
  });

  it('reads false from localStorage', () => {
    localStorage.setItem('chatroom:listingSidebarVisible', JSON.stringify(false));
    const { result } = renderHook(() => useChatroomListingSidebarVisible());
    expect(result.current[0]).toBe(false);
  });

  it('persists on set', () => {
    const { result } = renderHook(() => useChatroomListingSidebarVisible());
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(localStorage.getItem('chatroom:listingSidebarVisible')).toBe('false');
  });
});
