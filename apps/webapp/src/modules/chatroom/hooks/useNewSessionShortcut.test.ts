import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useNewSessionShortcut } from './useNewSessionShortcut';

describe('useNewSessionShortcut', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls onNewSession for Cmd+N', () => {
    const onNewSession = vi.fn();
    const addSpy = vi.spyOn(window, 'addEventListener');

    renderHook(() => useNewSessionShortcut({ onNewSession }));

    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), { capture: true });

    const handler = addSpy.mock.calls.find((call) => call[0] === 'keydown')?.[1] as (
      event: KeyboardEvent
    ) => void;

    const event = new KeyboardEvent('keydown', {
      key: 'n',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    const stopPropagation = vi.spyOn(event, 'stopPropagation');

    handler(event);

    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    expect(onNewSession).toHaveBeenCalledOnce();
  });

  it('ignores Cmd+Shift+N', () => {
    const onNewSession = vi.fn();
    const addSpy = vi.spyOn(window, 'addEventListener');

    renderHook(() => useNewSessionShortcut({ onNewSession }));

    const handler = addSpy.mock.calls.find((call) => call[0] === 'keydown')?.[1] as (
      event: KeyboardEvent
    ) => void;

    const event = new KeyboardEvent('keydown', {
      key: 'n',
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    handler(event);

    expect(onNewSession).not.toHaveBeenCalled();
  });

  it('ignores shortcuts without meta or ctrl', () => {
    const onNewSession = vi.fn();
    renderHook(() => useNewSessionShortcut({ onNewSession }));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));

    expect(onNewSession).not.toHaveBeenCalled();
  });

  it('ignores Ctrl+Alt+N', () => {
    const onNewSession = vi.fn();
    const addSpy = vi.spyOn(window, 'addEventListener');

    renderHook(() => useNewSessionShortcut({ onNewSession }));

    const handler = addSpy.mock.calls.find((call) => call[0] === 'keydown')?.[1] as (
      event: KeyboardEvent
    ) => void;

    const event = new KeyboardEvent('keydown', {
      key: 'n',
      metaKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });

    handler(event);

    expect(onNewSession).not.toHaveBeenCalled();
  });

  it('invokes onNewSession on every Cmd+N press', () => {
    const onNewSession = vi.fn();
    const addSpy = vi.spyOn(window, 'addEventListener');

    renderHook(() => useNewSessionShortcut({ onNewSession }));

    const handler = addSpy.mock.calls.find((call) => call[0] === 'keydown')?.[1] as (
      event: KeyboardEvent
    ) => void;

    const event = new KeyboardEvent('keydown', {
      key: 'n',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });

    handler(event);
    handler(event);

    expect(onNewSession).toHaveBeenCalledTimes(2);
  });
});
