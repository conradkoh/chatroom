import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';

import { usePersistedState } from './usePersistedState';

beforeEach(() => {
  localStorage.clear();
});

describe('usePersistedState', () => {
  it('returns the default value when nothing is stored', () => {
    const { result } = renderHook(() => usePersistedState('test-key', 'default'));
    expect(result.current[0]).toBe('default');
  });

  it('reads and parses a JSON-encoded stored value', () => {
    localStorage.setItem('test-key', JSON.stringify('stored-value'));
    const { result } = renderHook(() => usePersistedState('test-key', 'default'));
    expect(result.current[0]).toBe('stored-value');
  });

  it('reads a raw string (backward compat — non-JSON stored value)', () => {
    localStorage.setItem('test-key', 'raw-value');
    const { result } = renderHook(() => usePersistedState('test-key', 'default'));
    expect(result.current[0]).toBe('raw-value');
  });

  it('falls back to default on invalid stored value when validate is provided', () => {
    localStorage.setItem('test-key', JSON.stringify('invalid'));
    const { result } = renderHook(() =>
      usePersistedState('test-key', 'messages' as 'messages' | 'explorer', {
        validate: (v): v is 'messages' | 'explorer' => v === 'messages' || v === 'explorer',
      })
    );
    expect(result.current[0]).toBe('messages');
  });

  it('falls back to default when validate rejects a raw non-JSON string', () => {
    localStorage.setItem('test-key', 'invalid');
    const { result } = renderHook(() =>
      usePersistedState('test-key', 'messages' as 'messages' | 'explorer', {
        validate: (v): v is 'messages' | 'explorer' => v === 'messages' || v === 'explorer',
      })
    );
    expect(result.current[0]).toBe('messages');
  });

  it('persists valid value through validate type guard', () => {
    localStorage.setItem('test-key', JSON.stringify('explorer'));
    const { result } = renderHook(() =>
      usePersistedState('test-key', 'messages' as 'messages' | 'explorer', {
        validate: (v): v is 'messages' | 'explorer' => v === 'messages' || v === 'explorer',
      })
    );
    expect(result.current[0]).toBe('explorer');
  });

  it('setter persists to localStorage and updates state', () => {
    const { result } = renderHook(() => usePersistedState('test-key', 'initial'));
    act(() => result.current[1]('updated'));
    expect(result.current[0]).toBe('updated');
    expect(localStorage.getItem('test-key')).toBe(JSON.stringify('updated'));
  });

  it('re-syncs state from localStorage when key changes', () => {
    localStorage.setItem('cr-a:val', JSON.stringify('chatroom-a'));
    localStorage.setItem('cr-b:val', JSON.stringify('chatroom-b'));

    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => usePersistedState(key, 'default'),
      { initialProps: { key: 'cr-a:val' } }
    );

    expect(result.current[0]).toBe('chatroom-a');

    rerender({ key: 'cr-b:val' });
    expect(result.current[0]).toBe('chatroom-b');
  });

  it('handles boolean values with JSON round-trip', () => {
    const { result } = renderHook(() => usePersistedState('bool-key', false));
    expect(result.current[0]).toBe(false);

    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem('bool-key')).toBe('true');
  });

  it('handles null values', () => {
    const { result } = renderHook(() => usePersistedState<string | null>('null-key', null));

    act(() => result.current[1]('some-id'));
    expect(result.current[0]).toBe('some-id');

    act(() => result.current[1](null));
    expect(result.current[0]).toBe(null);
    expect(localStorage.getItem('null-key')).toBe('null');
  });

  it('gracefully handles localStorage.getItem throwing', () => {
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('quota exceeded');
    };

    const { result } = renderHook(() => usePersistedState('throw-key', 'safe-default'));
    expect(result.current[0]).toBe('safe-default');

    Storage.prototype.getItem = originalGetItem;
  });

  it('gracefully handles localStorage.setItem throwing', () => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota exceeded');
    };

    const { result } = renderHook(() => usePersistedState('throw-key', 'before'));
    act(() => result.current[1]('after'));
    expect(result.current[0]).toBe('after');

    Storage.prototype.setItem = originalSetItem;
  });
});
