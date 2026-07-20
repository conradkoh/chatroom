import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useCommandListScrollReset } from './useCommandListScrollReset';

describe('useCommandListScrollReset', () => {
  it('resets scrollTop when query changes', () => {
    const { result, rerender } = renderHook((query: string) => useCommandListScrollReset(query), {
      initialProps: '',
    });

    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollTop', { value: 50, writable: true });
    result.current.current = el;

    act(() => {
      rerender('new query');
    });

    expect(el.scrollTop).toBe(0);
  });

  it('does not throw when ref is null', () => {
    const { rerender } = renderHook((query: string) => useCommandListScrollReset(query), {
      initialProps: '',
    });

    expect(() => {
      rerender('new query');
    }).not.toThrow();
  });
});
