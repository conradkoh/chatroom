import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';

import { useExplorerSplitPanelMode } from './useExplorerSplitPanelMode';

const CHATROOM_A = 'cr-a' as never;
const CHATROOM_B = 'cr-b' as never;

beforeEach(() => {
  localStorage.clear();
});

describe('useExplorerSplitPanelMode', () => {
  it('defaults to messages when no stored value', () => {
    const { result } = renderHook(() => useExplorerSplitPanelMode(CHATROOM_A));
    expect(result.current[0]).toBe('messages');
  });

  it('persists mode to localStorage on change', () => {
    const { result } = renderHook(() => useExplorerSplitPanelMode(CHATROOM_A));
    act(() => result.current[1]('direct-harness'));
    expect(result.current[0]).toBe('direct-harness');
    expect(localStorage.getItem('chatroom:cr-a:explorerSplitPanelMode')).toBe(
      JSON.stringify('direct-harness')
    );
  });

  it('reads persisted value on mount', () => {
    localStorage.setItem('chatroom:cr-a:explorerSplitPanelMode', 'direct-harness');
    const { result } = renderHook(() => useExplorerSplitPanelMode(CHATROOM_A));
    expect(result.current[0]).toBe('direct-harness');
  });

  it('isolates between chatroom IDs', () => {
    localStorage.setItem('chatroom:cr-a:explorerSplitPanelMode', 'direct-harness');
    const { result: rA } = renderHook(() => useExplorerSplitPanelMode(CHATROOM_A));
    const { result: rB } = renderHook(() => useExplorerSplitPanelMode(CHATROOM_B));
    expect(rA.current[0]).toBe('direct-harness');
    expect(rB.current[0]).toBe('messages'); // B has no stored value
  });

  it('falls back to messages for unknown stored values', () => {
    localStorage.setItem('chatroom:cr-a:explorerSplitPanelMode', 'invalid-value');
    const { result } = renderHook(() => useExplorerSplitPanelMode(CHATROOM_A));
    expect(result.current[0]).toBe('messages');
  });
});
