import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAgenticSearchShortcut } from './useAgenticSearchShortcut';

describe('useAgenticSearchShortcut', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls onOpen for Cmd+F with capture listener', () => {
    const onOpen = vi.fn();
    const addSpy = vi.spyOn(window, 'addEventListener');

    renderHook(() => useAgenticSearchShortcut(onOpen));

    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), { capture: true });

    const handler = addSpy.mock.calls.find((call) => call[0] === 'keydown')?.[1] as (
      event: KeyboardEvent
    ) => void;

    const event = new KeyboardEvent('keydown', {
      key: 'f',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    const stopPropagation = vi.spyOn(event, 'stopPropagation');

    handler(event);

    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('ignores shortcuts without meta or ctrl', () => {
    const onOpen = vi.fn();
    renderHook(() => useAgenticSearchShortcut(onOpen));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));

    expect(onOpen).not.toHaveBeenCalled();
  });
});
