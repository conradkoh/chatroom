import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getComposerPreflightShortcutLabel,
  isComposerPreflightShortcut,
  isWindowsPlatform,
  useComposerPreflightShortcut,
} from './useComposerPreflightShortcut';

function mockPlatform(platform: string) {
  Object.defineProperty(navigator, 'platform', {
    configurable: true,
    value: platform,
  });
}

describe('isWindowsPlatform', () => {
  it('detects Windows', () => {
    mockPlatform('Win32');
    expect(isWindowsPlatform()).toBe(true);
  });

  it('detects macOS as non-Windows', () => {
    mockPlatform('MacIntel');
    expect(isWindowsPlatform()).toBe(false);
  });
});

describe('getComposerPreflightShortcutLabel', () => {
  it('returns Ctrl+N on macOS', () => {
    mockPlatform('MacIntel');
    expect(getComposerPreflightShortcutLabel('N')).toBe('Ctrl+N');
  });

  it('returns Alt+M on Windows', () => {
    mockPlatform('Win32');
    expect(getComposerPreflightShortcutLabel('M')).toBe('Alt+M');
  });
});

describe('isComposerPreflightShortcut', () => {
  beforeEach(() => {
    mockPlatform('MacIntel');
  });

  it('matches Ctrl+N on macOS', () => {
    expect(
      isComposerPreflightShortcut(
        new KeyboardEvent('keydown', { code: 'KeyN', key: 'n', ctrlKey: true }),
        'KeyN'
      )
    ).toBe(true);
  });

  it('matches Ctrl+M on Linux', () => {
    mockPlatform('Linux x86_64');
    expect(
      isComposerPreflightShortcut(
        new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', ctrlKey: true }),
        'KeyM'
      )
    ).toBe(true);
  });

  it('matches Alt+N on Windows', () => {
    mockPlatform('Win32');
    expect(
      isComposerPreflightShortcut(
        new KeyboardEvent('keydown', { code: 'KeyN', key: 'n', altKey: true }),
        'KeyN'
      )
    ).toBe(true);
  });

  it('ignores plain N', () => {
    expect(
      isComposerPreflightShortcut(new KeyboardEvent('keydown', { code: 'KeyN', key: 'n' }), 'KeyN')
    ).toBe(false);
  });

  it('ignores Alt+N on macOS (non-Windows uses Ctrl)', () => {
    expect(
      isComposerPreflightShortcut(
        new KeyboardEvent('keydown', { code: 'KeyN', key: '˜', altKey: true }),
        'KeyN'
      )
    ).toBe(false);
  });

  it('ignores Ctrl+N on Windows (Windows uses Alt)', () => {
    mockPlatform('Win32');
    expect(
      isComposerPreflightShortcut(
        new KeyboardEvent('keydown', { code: 'KeyN', key: 'n', ctrlKey: true }),
        'KeyN'
      )
    ).toBe(false);
  });

  it('ignores Meta+Ctrl+N', () => {
    expect(
      isComposerPreflightShortcut(
        new KeyboardEvent('keydown', { code: 'KeyN', key: 'n', ctrlKey: true, metaKey: true }),
        'KeyN'
      )
    ).toBe(false);
  });

  it('ignores Ctrl+Shift+M', () => {
    expect(
      isComposerPreflightShortcut(
        new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', ctrlKey: true, shiftKey: true }),
        'KeyM'
      )
    ).toBe(false);
  });
});

describe('useComposerPreflightShortcut', () => {
  beforeEach(() => {
    mockPlatform('MacIntel');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls onTrigger for Ctrl+M on macOS and consumes the event', () => {
    const onTrigger = vi.fn();
    const addSpy = vi.spyOn(window, 'addEventListener');
    renderHook(() => useComposerPreflightShortcut({ code: 'KeyM', onTrigger }));

    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), { capture: true });
    const event = new KeyboardEvent('keydown', {
      code: 'KeyM',
      key: 'm',
      ctrlKey: true,
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
    renderHook(() => useComposerPreflightShortcut({ code: 'KeyM', enabled: false, onTrigger }));
    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', ctrlKey: true, bubbles: true })
    );
    expect(onTrigger).not.toHaveBeenCalled();
  });
});
