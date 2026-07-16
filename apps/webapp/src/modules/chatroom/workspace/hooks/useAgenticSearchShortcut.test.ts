import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAgenticSearchShortcut } from './useAgenticSearchShortcut';

describe('useAgenticSearchShortcut', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls onOpen for Cmd+Shift+F', () => {
    const onOpen = vi.fn();
    const addSpy = vi.spyOn(window, 'addEventListener');

    renderHook(() => useAgenticSearchShortcut({ onOpen }));

    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), { capture: true });

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
    const preventDefault = vi.spyOn(event, 'preventDefault');
    const stopPropagation = vi.spyOn(event, 'stopPropagation');

    handler(event);

    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('ignores plain Cmd+F (no shift)', () => {
    const onOpen = vi.fn();
    const addSpy = vi.spyOn(window, 'addEventListener');

    renderHook(() => useAgenticSearchShortcut({ onOpen }));

    const handler = addSpy.mock.calls.find((call) => call[0] === 'keydown')?.[1] as (
      event: KeyboardEvent
    ) => void;

    const event = new KeyboardEvent('keydown', {
      key: 'f',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });

    handler(event);

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('ignores shortcuts without meta or ctrl', () => {
    const onOpen = vi.fn();
    renderHook(() => useAgenticSearchShortcut({ onOpen }));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', shiftKey: true, bubbles: true }));

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('ignores Cmd+Alt+Shift+F', () => {
    const onOpen = vi.fn();
    const addSpy = vi.spyOn(window, 'addEventListener');

    renderHook(() => useAgenticSearchShortcut({ onOpen }));

    const handler = addSpy.mock.calls.find((call) => call[0] === 'keydown')?.[1] as (
      event: KeyboardEvent
    ) => void;

    const event = new KeyboardEvent('keydown', {
      key: 'f',
      metaKey: true,
      shiftKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });

    handler(event);

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('invokes onOpen on every Cmd+Shift+F press (shortcut does not debounce)', () => {
    const onOpen = vi.fn();
    const addSpy = vi.spyOn(window, 'addEventListener');

    renderHook(() => useAgenticSearchShortcut({ onOpen }));

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
    handler(event);

    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});
