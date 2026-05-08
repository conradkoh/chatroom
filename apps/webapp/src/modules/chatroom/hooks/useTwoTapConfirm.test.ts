import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTwoTapConfirm } from './useTwoTapConfirm';

describe('useTwoTapConfirm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('first request arms; second within window fires onConfirm and clears', () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() => useTwoTapConfirm<string>(onConfirm, 3000));

    // First tap: arm
    act(() => {
      result.current.request('cmd-1');
    });
    expect(result.current.armedKey).toBe('cmd-1');
    expect(onConfirm).not.toHaveBeenCalled();

    // Second tap: confirm
    act(() => {
      result.current.request('cmd-1');
    });
    expect(onConfirm).toHaveBeenCalledWith('cmd-1');
    expect(result.current.armedKey).toBeUndefined();
  });

  it('request with different key resets timer and arms new key', () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() => useTwoTapConfirm<string>(onConfirm, 3000));

    // Arm first key
    act(() => {
      result.current.request('cmd-1');
    });
    expect(result.current.armedKey).toBe('cmd-1');

    // Request a different key
    act(() => {
      result.current.request('cmd-2');
    });
    expect(result.current.armedKey).toBe('cmd-2');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('armed state auto-clears after timeoutMs', () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() => useTwoTapConfirm<string>(onConfirm, 3000));

    act(() => {
      result.current.request('cmd-1');
    });
    expect(result.current.armedKey).toBe('cmd-1');

    // Advance past timeout
    act(() => {
      vi.advanceTimersByTime(3001);
    });
    expect(result.current.armedKey).toBeUndefined();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('reset() clears armed state immediately', () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() => useTwoTapConfirm<string>(onConfirm, 3000));

    act(() => {
      result.current.request('cmd-1');
    });
    expect(result.current.armedKey).toBe('cmd-1');

    act(() => {
      result.current.reset();
    });
    expect(result.current.armedKey).toBeUndefined();
  });
});
