import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isAltShortcut, useAltShortcut } from './useAltShortcut';

describe('isAltShortcut', () => {
  it('matches Alt+N by physical key code', () => {
    expect(
      isAltShortcut(new KeyboardEvent('keydown', { code: 'KeyN', key: 'n', altKey: true }), 'KeyN')
    ).toBe(true);
  });

  it('matches Option+N on macOS where event.key is a special character', () => {
    expect(
      isAltShortcut(new KeyboardEvent('keydown', { code: 'KeyN', key: '˜', altKey: true }), 'KeyN')
    ).toBe(true);
  });

  it('matches Option+E on macOS where event.key is a special character', () => {
    expect(
      isAltShortcut(new KeyboardEvent('keydown', { code: 'KeyE', key: '´', altKey: true }), 'KeyE')
    ).toBe(true);
  });

  it('ignores plain N', () => {
    expect(isAltShortcut(new KeyboardEvent('keydown', { code: 'KeyN', key: 'n' }), 'KeyN')).toBe(
      false
    );
  });

  it('ignores Meta+Alt+N', () => {
    expect(
      isAltShortcut(
        new KeyboardEvent('keydown', { code: 'KeyN', key: 'n', altKey: true, metaKey: true }),
        'KeyN'
      )
    ).toBe(false);
  });

  it('ignores Ctrl+Alt+N', () => {
    expect(
      isAltShortcut(
        new KeyboardEvent('keydown', { code: 'KeyN', key: 'n', altKey: true, ctrlKey: true }),
        'KeyN'
      )
    ).toBe(false);
  });

  it('ignores Alt+Shift+E', () => {
    expect(
      isAltShortcut(
        new KeyboardEvent('keydown', { code: 'KeyE', key: 'e', altKey: true, shiftKey: true }),
        'KeyE'
      )
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
    renderHook(() => useAltShortcut({ code: 'KeyE', onTrigger }));

    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), { capture: true });
    const event = new KeyboardEvent('keydown', {
      code: 'KeyE',
      key: '´',
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
    renderHook(() => useAltShortcut({ code: 'KeyE', enabled: false, onTrigger }));
    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyE', key: 'e', altKey: true, bubbles: true })
    );
    expect(onTrigger).not.toHaveBeenCalled();
  });
});
