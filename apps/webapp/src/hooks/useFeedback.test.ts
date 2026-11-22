import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useFeedback } from './useFeedback';

describe('useFeedback', () => {
  it('starts with no feedback', () => {
    const { result } = renderHook(() => useFeedback());

    expect(result.current.feedback).toBeNull();
  });

  it('shows a success message with the first id', () => {
    const { result } = renderHook(() => useFeedback());

    act(() => {
      result.current.show('success', 'Saved');
    });

    expect(result.current.feedback).toEqual({ id: 1, tone: 'success', message: 'Saved' });
  });

  it('errors through the error helper', () => {
    const { result } = renderHook(() => useFeedback());

    act(() => {
      result.current.error('Boom');
    });

    expect(result.current.feedback).toEqual({ id: 1, tone: 'error', message: 'Boom' });
  });

  it('passes extra options through', () => {
    const { result } = renderHook(() => useFeedback());

    act(() => {
      result.current.show('warning', 'Limit saved', {
        title: 'Heads up',
        items: ['a', 'b'],
        icon: false,
      });
    });

    expect(result.current.feedback).toEqual({
      id: 1,
      tone: 'warning',
      message: 'Limit saved',
      title: 'Heads up',
      items: ['a', 'b'],
      icon: false,
    });
  });

  it('keeps icon: false from error extras', () => {
    const { result } = renderHook(() => useFeedback());

    act(() => {
      result.current.error('Bad', { icon: false });
    });

    expect(result.current.feedback).toEqual({ id: 1, tone: 'error', message: 'Bad', icon: false });
  });

  it('increments ids per call', () => {
    const { result } = renderHook(() => useFeedback());

    act(() => {
      result.current.show('info', 'One');
    });
    expect(result.current.feedback?.id).toBe(1);

    act(() => {
      result.current.show('info', 'Two');
    });
    expect(result.current.feedback?.id).toBe(2);

    act(() => {
      result.current.error('Three');
    });
    expect(result.current.feedback?.id).toBe(3);
  });

  it('clears feedback without resetting the id counter', () => {
    const { result } = renderHook(() => useFeedback());

    act(() => {
      result.current.show('info', 'One');
    });
    act(() => {
      result.current.show('info', 'Two');
    });
    act(() => {
      result.current.error('Three');
    });

    act(() => {
      result.current.clear();
    });
    expect(result.current.feedback).toBeNull();

    act(() => {
      result.current.show('info', 'Four');
    });
    expect(result.current.feedback).toEqual({ id: 4, tone: 'info', message: 'Four' });
  });

  it('allows a tone with no message', () => {
    const { result } = renderHook(() => useFeedback());

    act(() => {
      result.current.show('info');
    });

    expect(result.current.feedback).toEqual({ id: 1, tone: 'info' });
  });
});
