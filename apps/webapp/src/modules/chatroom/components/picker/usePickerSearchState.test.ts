import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { usePickerSearchState } from './usePickerSearchState';

describe('usePickerSearchState', () => {
  it('starts with empty search term', () => {
    const { result } = renderHook(() => usePickerSearchState(vi.fn()));
    expect(result.current.searchTerm).toBe('');
  });

  it('updates search term via setSearchTerm', () => {
    const { result } = renderHook(() => usePickerSearchState(vi.fn()));
    act(() => result.current.setSearchTerm('hello'));
    expect(result.current.searchTerm).toBe('hello');
  });

  it('clears search term when handleOpenChange is called with false', () => {
    const onOpenChange = vi.fn();
    const { result } = renderHook(() => usePickerSearchState(onOpenChange));

    act(() => result.current.setSearchTerm('hello'));
    expect(result.current.searchTerm).toBe('hello');

    act(() => result.current.handleOpenChange(false));
    expect(result.current.searchTerm).toBe('');
  });

  it('does not clear search term when handleOpenChange is called with true', () => {
    const onOpenChange = vi.fn();
    const { result } = renderHook(() => usePickerSearchState(onOpenChange));

    act(() => result.current.setSearchTerm('hello'));

    act(() => result.current.handleOpenChange(true));
    expect(result.current.searchTerm).toBe('hello');
  });

  it('forwards handleOpenChange calls to the parent onOpenChange', () => {
    const onOpenChange = vi.fn();
    const { result } = renderHook(() => usePickerSearchState(onOpenChange));

    act(() => result.current.handleOpenChange(true));
    expect(onOpenChange).toHaveBeenCalledWith(true);

    act(() => result.current.handleOpenChange(false));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
