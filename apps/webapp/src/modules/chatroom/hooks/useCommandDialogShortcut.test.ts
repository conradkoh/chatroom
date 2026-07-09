import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { useCommandDialogShortcut } from './useCommandDialogShortcut';

const openDialog = vi.fn();
const closeDialog = vi.fn();

let activeDialog: 'switcher' | 'file-selector' | 'command-palette' | null = null;

vi.mock('@/modules/chatroom/context/CommandDialogContext', () => ({
  useCommandDialog: () => ({
    activeDialog,
    openDialog,
    closeDialog,
  }),
}));

function pressShortcut(init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, ...init });
  const preventDefault = vi.spyOn(event, 'preventDefault');
  document.dispatchEvent(event);
  return preventDefault;
}

describe('useCommandDialogShortcut', () => {
  const originalPlatform = navigator.platform;

  beforeEach(() => {
    activeDialog = null;
    openDialog.mockClear();
    closeDialog.mockClear();
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
  });

  it('opens the switcher on Cmd+K when closed', () => {
    renderHook(() => useCommandDialogShortcut({ dialog: 'switcher', key: 'k' }));

    expect(pressShortcut({ key: 'k', metaKey: true })).toHaveBeenCalled();
    expect(openDialog).toHaveBeenCalledWith('switcher');
    expect(closeDialog).not.toHaveBeenCalled();
  });

  it('closes the switcher on Cmd+K when open', () => {
    activeDialog = 'switcher';
    renderHook(() => useCommandDialogShortcut({ dialog: 'switcher', key: 'k' }));

    pressShortcut({ key: 'k', metaKey: true });
    expect(closeDialog).toHaveBeenCalled();
    expect(openDialog).not.toHaveBeenCalled();
  });

  it('opens file selector on Cmd+P but not Cmd+Shift+P', () => {
    renderHook(() =>
      useCommandDialogShortcut({ dialog: 'file-selector', key: 'p', shiftKey: 'forbidden' })
    );

    pressShortcut({ key: 'p', metaKey: true, shiftKey: true });
    expect(openDialog).not.toHaveBeenCalled();

    pressShortcut({ key: 'p', metaKey: true });
    expect(openDialog).toHaveBeenCalledWith('file-selector');
  });

  it('opens command palette on Cmd+Shift+P only', () => {
    renderHook(() =>
      useCommandDialogShortcut({
        dialog: 'command-palette',
        key: 'p',
        shiftKey: 'required',
      })
    );

    pressShortcut({ key: 'p', metaKey: true });
    expect(openDialog).not.toHaveBeenCalled();

    pressShortcut({ key: 'p', metaKey: true, shiftKey: true });
    expect(openDialog).toHaveBeenCalledWith('command-palette');
  });

  it('uses Ctrl modifier on non-Mac platforms', () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    renderHook(() => useCommandDialogShortcut({ dialog: 'switcher', key: 'k' }));

    pressShortcut({ key: 'k', ctrlKey: true });
    expect(openDialog).toHaveBeenCalledWith('switcher');
  });
});
