import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useCopyOwnedFeedback } from './useCopyOwnedFeedback';

describe('useCopyOwnedFeedback', () => {
  it('clears a copy failure when a copy succeeds', () => {
    const { result } = renderHook(() => useCopyOwnedFeedback());

    act(() => {
      result.current.showCopyError('Failed to copy to clipboard');
    });
    expect(result.current.feedback?.message).toBe('Failed to copy to clipboard');

    act(() => {
      result.current.copySucceeded();
    });
    expect(result.current.feedback).toBeNull();
  });

  it('keeps a non-copy error when a copy succeeds', () => {
    const { result } = renderHook(() => useCopyOwnedFeedback());

    act(() => {
      result.current.showError('Could not do X');
    });
    act(() => {
      result.current.copySucceeded();
    });

    expect(result.current.feedback?.message).toBe('Could not do X');
  });

  it('keeps a non-copy error that replaced a copy failure', () => {
    const { result } = renderHook(() => useCopyOwnedFeedback());

    act(() => {
      result.current.showCopyError('Failed to copy to clipboard');
    });
    act(() => {
      result.current.showError('Could not do X');
    });
    act(() => {
      result.current.copySucceeded();
    });

    expect(result.current.feedback?.message).toBe('Could not do X');
  });

  it('keeps a non-copy error written after a clear', () => {
    const { result } = renderHook(() => useCopyOwnedFeedback());

    act(() => {
      result.current.showCopyError('Failed to copy to clipboard');
    });
    act(() => {
      result.current.clear();
    });
    act(() => {
      result.current.showError('Could not do X');
    });
    act(() => {
      result.current.copySucceeded();
    });

    expect(result.current.feedback?.message).toBe('Could not do X');
  });
});
