import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';

import { useCommandFavorites } from './useCommandFavorites';
import { getCommandFavoritesStore } from '../stores/commandFavoritesStore';

describe('useCommandFavorites', () => {
  beforeEach(() => {
    getCommandFavoritesStore().clear();
  });

  test('returns empty set initially', () => {
    const { result } = renderHook(() => useCommandFavorites());
    expect(result.current.favorites.size).toBe(0);
    expect(result.current.revision).toBe(1);
  });

  test('toggle adds a command and updates revision', () => {
    const { result } = renderHook(() => useCommandFavorites());

    act(() => {
      result.current.toggle('dev');
    });

    expect(result.current.favorites.has('dev')).toBe(true);
    expect(result.current.revision).toBeGreaterThan(0);
  });

  test('toggle removes a command on second call', () => {
    const { result } = renderHook(() => useCommandFavorites());

    act(() => {
      result.current.toggle('dev');
    });
    expect(result.current.favorites.has('dev')).toBe(true);

    act(() => {
      result.current.toggle('dev');
    });
    expect(result.current.favorites.has('dev')).toBe(false);
  });

  test('isFavorite returns correct membership', () => {
    const { result } = renderHook(() => useCommandFavorites());

    expect(result.current.isFavorite('build')).toBe(false);

    act(() => {
      result.current.toggle('build');
    });

    expect(result.current.isFavorite('build')).toBe(true);
  });

  test('favorites set is a new copy each time (immutable)', () => {
    const { result } = renderHook(() => useCommandFavorites());

    act(() => {
      result.current.toggle('test');
    });

    const firstSnapshot = result.current.favorites;
    act(() => {
      result.current.toggle('lint');
    });

    expect(firstSnapshot).not.toBe(result.current.favorites);
  });
});
