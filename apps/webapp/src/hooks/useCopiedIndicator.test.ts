import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCopiedIndicator } from './useCopiedIndicator';

describe('useCopiedIndicator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is false initially', () => {
    const { result } = renderHook(() => useCopiedIndicator());

    expect(result.current.copied).toBe(false);
  });

  it('is true right after markCopied', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCopiedIndicator());

    act(() => {
      result.current.markCopied();
    });

    expect(result.current.copied).toBe(true);
  });

  it('reverts after the 2 s window', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCopiedIndicator());

    act(() => {
      result.current.markCopied();
    });
    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.copied).toBe(false);
  });

  it('restarts the window on a second markCopied', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCopiedIndicator());

    act(() => {
      result.current.markCopied();
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    act(() => {
      result.current.markCopied();
    });

    act(() => {
      vi.advanceTimersByTime(1900);
    });
    // 3400 ms from the first call, but only 1900 ms from the second.
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.copied).toBe(false);
  });

  it('clears the pending timer on unmount without updating state', () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useCopiedIndicator());

    act(() => {
      result.current.markCopied();
    });
    unmount();

    expect(() => {
      act(() => {
        vi.advanceTimersByTime(2000);
      });
    }).not.toThrow();
  });
});
