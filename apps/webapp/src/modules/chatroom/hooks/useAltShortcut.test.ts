import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isAltShortcut, useAltShortcut } from './useAltShortcut';

describe('isAltShortcut', () => {
  it('matches Alt+N', () => {
    expect(isAltShortcut(new KeyboardEvent('keydown', { key: 'n', altKey: true }), 'n')).toBe(true);
  });

  it('matches the key case-insensitively', () => {
    expect(isAltShortcut(new KeyboardEvent('keydown', { key: 'E', altKey: true }), 'e')).toBe(true);
  });

  it('ignores plain N', () => {
    expect(isAltShortcut(new KeyboardEvent('keydown', { key: 'n' }), 'n')).toBe(false);
  });

  it('ignores Meta+Alt+N', () => {
    expect(
      isAltShortcut(new KeyboardEvent('keydown', { key: 'n', altKey: true, metaKey: true }), 'n')
    ).toBe(false);
  });

  it('ignores Ctrl+Alt+N', () => {
    expect(
      isAltShortcut(new KeyboardEvent('keydown', { key: 'n', altKey: true, ctrlKey: true }), 'n')
    ).toBe(false);
  });

  it('ignores Alt+Shift+E', () => {
    expect(
      isAltShortcut(new KeyboardEvent('keydown', { key: 'e', altKey: true, shiftKey: true }), 'e')
    ).toBe(false);
  });
});

describe('useAltShortcut', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls onTrigger for Alt+E and consumes the event', () => {
    const onTrigger = vi.fn();
    const addSpy = vi.spyOn(window, 'addEventListener');
    renderHook(() => useAltShortcut({ key: 'e', onTrigger }));

    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), { capture: true });
    const event = new KeyboardEvent('keydown', {
      key: 'e',
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    const stopPropagation = vi.spyOn(event, 'stopPropagation');

    window.dispatchEvent(event);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(onTrigger).toHaveBeenCalledOnce();
  });

  it('does not call onTrigger when disabled', () => {
    const onTrigger = vi.fn();
    renderHook(() => useAltShortcut({ key: 'e', enabled: false, onTrigger }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', altKey: true, bubbles: true }));
    expect(onTrigger).not.toHaveBeenCalled();
  });
});
