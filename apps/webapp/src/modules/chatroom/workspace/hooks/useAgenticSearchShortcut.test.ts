import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAgenticSearchShortcut } from './useAgenticSearchShortcut';

describe('useAgenticSearchShortcut', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls onOpenSearch for Cmd+F', () => {
    const onOpenSearch = vi.fn();
    const onOpenAsk = vi.fn();
    const addSpy = vi.spyOn(window, 'addEventListener');

    renderHook(() => useAgenticSearchShortcut({ onOpenSearch, onOpenAsk }));

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
    expect(onOpenSearch).toHaveBeenCalledOnce();
    expect(onOpenAsk).not.toHaveBeenCalled();
  });

  it('calls onOpenAsk for Cmd+Shift+F', () => {
    const onOpenSearch = vi.fn();
    const onOpenAsk = vi.fn();
    const addSpy = vi.spyOn(window, 'addEventListener');

    renderHook(() => useAgenticSearchShortcut({ onOpenSearch, onOpenAsk }));

    const handler = addSpy.mock.calls.find((call) => call[0] === 'keydown')?.[1] as (
      event: KeyboardEvent
    ) => void;

    const event = new KeyboardEvent('keydown', {
      key: 'f',
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    handler(event);

    expect(onOpenSearch).not.toHaveBeenCalled();
    expect(onOpenAsk).toHaveBeenCalledOnce();
  });

  it('ignores shortcuts without meta or ctrl', () => {
    const onOpenSearch = vi.fn();
    const onOpenAsk = vi.fn();
    renderHook(() => useAgenticSearchShortcut({ onOpenSearch, onOpenAsk }));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));

    expect(onOpenSearch).not.toHaveBeenCalled();
    expect(onOpenAsk).not.toHaveBeenCalled();
  });

  it('ignores Cmd+Alt+F', () => {
    const onOpenSearch = vi.fn();
    const onOpenAsk = vi.fn();
    renderHook(() => useAgenticSearchShortcut({ onOpenSearch, onOpenAsk }));

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'f', metaKey: true, altKey: true, bubbles: true })
    );

    expect(onOpenSearch).not.toHaveBeenCalled();
    expect(onOpenAsk).not.toHaveBeenCalled();
  });
});
