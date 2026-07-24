import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEnhancerDiffViewMode } from './useEnhancerDiffViewMode';

let mockIsDesktop = true;

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => mockIsDesktop,
}));

describe('useEnhancerDiffViewMode', () => {
  beforeEach(() => {
    mockIsDesktop = true;
  });

  it('defaults to split on desktop', () => {
    const { result } = renderHook(() => useEnhancerDiffViewMode());
    expect(result.current.viewMode).toBe('split');
  });

  it('defaults to unified on mobile', () => {
    mockIsDesktop = false;
    const { result } = renderHook(() => useEnhancerDiffViewMode());
    expect(result.current.viewMode).toBe('unified');
  });

  it('allows user override via setViewMode', () => {
    const { result } = renderHook(() => useEnhancerDiffViewMode());

    act(() => {
      result.current.setViewMode('unified');
    });

    expect(result.current.viewMode).toBe('unified');
  });

  it('resetViewMode restores platform default', () => {
    const { result } = renderHook(() => useEnhancerDiffViewMode());

    act(() => {
      result.current.setViewMode('unified');
      result.current.resetViewMode();
    });

    expect(result.current.viewMode).toBe('split');
  });
});
