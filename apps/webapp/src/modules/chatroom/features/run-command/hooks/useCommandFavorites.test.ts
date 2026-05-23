import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the commandFavoritesStore
const mockStore = {
  getAll: vi.fn(() => new Set<string>()),
  toggle: vi.fn(),
};

vi.mock('../../../lib/commandFavoritesStore', () => ({
  getCommandFavoritesStore: () => mockStore,
}));

import { useCommandFavorites } from './useCommandFavorites';

describe('useCommandFavorites', () => {
  beforeEach(() => {
    mockStore.getAll.mockReturnValue(new Set<string>());
    mockStore.toggle.mockReset();
  });

  it('returns empty favorites by default', () => {
    const { result } = renderHook(() => useCommandFavorites());
    expect(result.current.favorites.size).toBe(0);
  });

  it('isFavorite returns false for unknown command', () => {
    const { result } = renderHook(() => useCommandFavorites());
    expect(result.current.isFavorite('some-command')).toBe(false);
  });

  it('toggle calls store.toggle and bumps version', () => {
    mockStore.getAll
      .mockReturnValueOnce(new Set<string>())
      .mockReturnValue(new Set(['my-command']));

    const { result } = renderHook(() => useCommandFavorites());
    expect(result.current.favorites.size).toBe(0);

    act(() => {
      result.current.toggle('my-command');
    });

    expect(mockStore.toggle).toHaveBeenCalledWith('my-command');
    expect(result.current.favorites.has('my-command')).toBe(true);
  });

  it('isFavorite reflects updated favorites after toggle', () => {
    mockStore.getAll
      .mockReturnValueOnce(new Set<string>())
      .mockReturnValue(new Set(['cmd-a']));

    const { result } = renderHook(() => useCommandFavorites());
    expect(result.current.isFavorite('cmd-a')).toBe(false);

    act(() => {
      result.current.toggle('cmd-a');
    });

    expect(result.current.isFavorite('cmd-a')).toBe(true);
  });

  it('exposes version that increments on toggle', () => {
    const { result } = renderHook(() => useCommandFavorites());
    const initialVersion = result.current.version;

    act(() => {
      result.current.toggle('cmd-b');
    });

    expect(result.current.version).toBe(initialVersion + 1);
  });
});
