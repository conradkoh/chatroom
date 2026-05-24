import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';

import { useExplorerSyncPreference } from './useExplorerSyncPreference';

const CHATROOM_A = 'cr-a' as never;
const CHATROOM_B = 'cr-b' as never;

beforeEach(() => {
  localStorage.clear();
});

describe('useExplorerSyncPreference', () => {
  it('defaults to true when nothing is stored', () => {
    const { result } = renderHook(() => useExplorerSyncPreference(CHATROOM_A));
    expect(result.current[0]).toBe(true);
  });

  it('reads false from localStorage', () => {
    localStorage.setItem('chatroom:cr-a:explorerSyncWithEditor', JSON.stringify(false));
    const { result } = renderHook(() => useExplorerSyncPreference(CHATROOM_A));
    expect(result.current[0]).toBe(false);
  });

  it('reads true from localStorage', () => {
    localStorage.setItem('chatroom:cr-a:explorerSyncWithEditor', JSON.stringify(true));
    const { result } = renderHook(() => useExplorerSyncPreference(CHATROOM_A));
    expect(result.current[0]).toBe(true);
  });

  it('setter persists to localStorage and updates state', () => {
    const { result } = renderHook(() => useExplorerSyncPreference(CHATROOM_A));
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(localStorage.getItem('chatroom:cr-a:explorerSyncWithEditor')).toBe('false');

    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem('chatroom:cr-a:explorerSyncWithEditor')).toBe('true');
  });

  it('isolates between chatrooms', () => {
    localStorage.setItem('chatroom:cr-a:explorerSyncWithEditor', JSON.stringify(true));
    localStorage.setItem('chatroom:cr-b:explorerSyncWithEditor', JSON.stringify(false));

    const { result: rA } = renderHook(() => useExplorerSyncPreference(CHATROOM_A));
    const { result: rB } = renderHook(() => useExplorerSyncPreference(CHATROOM_B));

    expect(rA.current[0]).toBe(true);
    expect(rB.current[0]).toBe(false);
  });

  it('falls back to default when stored value is not boolean', () => {
    localStorage.setItem('chatroom:cr-a:explorerSyncWithEditor', JSON.stringify('not-a-boolean'));
    const { result } = renderHook(() => useExplorerSyncPreference(CHATROOM_A));
    expect(result.current[0]).toBe(true);
  });

  it('falls back to default when localStorage is corrupted', () => {
    localStorage.setItem('chatroom:cr-a:explorerSyncWithEditor', '{broken json');
    const { result } = renderHook(() => useExplorerSyncPreference(CHATROOM_A));
    expect(result.current[0]).toBe(true);
  });
});
