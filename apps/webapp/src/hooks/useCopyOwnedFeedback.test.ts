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

  it('report writes a titled draft and keeps it after a copy success', () => {
    const { result } = renderHook(() => useCopyOwnedFeedback());

    act(() => {
      result.current.report({
        tone: 'error',
        title: 'Failed to stop agents',
        items: ['Agents: boom'],
      });
    });
    expect(result.current.feedback?.title).toBe('Failed to stop agents');
    expect(result.current.feedback?.items).toEqual(['Agents: boom']);
    expect(result.current.feedback?.tone).toBe('error');

    act(() => {
      result.current.copySucceeded();
    });

    expect(result.current.feedback?.title).toBe('Failed to stop agents');
    expect(result.current.feedback?.items).toEqual(['Agents: boom']);
    expect(result.current.feedback?.tone).toBe('error');
  });

  it('report(null) clears a copy failure', () => {
    const { result } = renderHook(() => useCopyOwnedFeedback());

    act(() => {
      result.current.showCopyError('Failed to copy to clipboard');
    });
    act(() => {
      result.current.report(null);
    });

    expect(result.current.feedback).toBeNull();
  });

  it('report over a copy failure is not copy-owned', () => {
    const { result } = renderHook(() => useCopyOwnedFeedback());

    act(() => {
      result.current.showCopyError('Failed to copy to clipboard');
    });
    act(() => {
      result.current.report({ tone: 'error', message: 'Could not do X' });
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

  it('shows a truncated copy as a warning', () => {
    const { result } = renderHook(() => useCopyOwnedFeedback());

    act(() => {
      result.current.copySucceeded({ truncated: true });
    });

    expect(result.current.feedback?.tone).toBe('warning');
    expect(result.current.feedback?.message).toBe('Copied file content (truncated)');
  });

  it('clears the truncation warning on a later copy that is not truncated', () => {
    const { result } = renderHook(() => useCopyOwnedFeedback());

    act(() => {
      result.current.copySucceeded({ truncated: true });
    });
    act(() => {
      result.current.copySucceeded({ truncated: false });
    });

    expect(result.current.feedback).toBeNull();
  });

  it('keeps a non-copy error when a truncated copy is not reported', () => {
    const { result } = renderHook(() => useCopyOwnedFeedback());

    act(() => {
      result.current.showError('Could not do X');
    });
    act(() => {
      result.current.copySucceeded({ truncated: false });
    });

    expect(result.current.feedback?.message).toBe('Could not do X');
  });
});
