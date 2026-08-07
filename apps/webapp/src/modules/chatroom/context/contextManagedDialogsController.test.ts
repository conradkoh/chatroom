import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeContextManagedDialog,
  getActiveContextManagedDialog,
  getChatroomSwitcherOpen,
  getFileSelectorOpen,
  openContextManagedDialog,
  resetContextManagedDialogs,
  resetContextManagedDialogsForTests,
  setActiveContextManagedDialog,
  subscribeActiveContextManagedDialog,
} from './contextManagedDialogsController';

describe('contextManagedDialogsController', () => {
  beforeEach(() => {
    resetContextManagedDialogsForTests();
  });

  afterEach(() => {
    resetContextManagedDialogsForTests();
  });

  it('starts closed', () => {
    expect(getActiveContextManagedDialog()).toBeNull();
    expect(getChatroomSwitcherOpen()).toBe(false);
    expect(getFileSelectorOpen()).toBe(false);
  });

  it('setActiveContextManagedDialog notifies subscribers on change', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeActiveContextManagedDialog(listener);

    setActiveContextManagedDialog('switcher');
    expect(getActiveContextManagedDialog()).toBe('switcher');
    expect(getChatroomSwitcherOpen()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('does not notify when set to the same dialog', () => {
    const listener = vi.fn();
    subscribeActiveContextManagedDialog(listener);

    setActiveContextManagedDialog('switcher');
    expect(listener).toHaveBeenCalledTimes(1);

    setActiveContextManagedDialog('switcher');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('openContextManagedDialog replaces the other dialog (mutual exclusivity)', () => {
    openContextManagedDialog('file-selector');
    expect(getFileSelectorOpen()).toBe(true);

    openContextManagedDialog('switcher');
    expect(getChatroomSwitcherOpen()).toBe(true);
    expect(getFileSelectorOpen()).toBe(false);
    expect(getActiveContextManagedDialog()).toBe('switcher');
  });

  it('closeContextManagedDialog closes', () => {
    openContextManagedDialog('switcher');
    closeContextManagedDialog();
    expect(getActiveContextManagedDialog()).toBeNull();
  });

  it('resetContextManagedDialogs closes and notifies only when open', () => {
    const listener = vi.fn();
    subscribeActiveContextManagedDialog(listener);

    resetContextManagedDialogs();
    expect(listener).not.toHaveBeenCalled();

    openContextManagedDialog('file-selector');
    expect(listener).toHaveBeenCalledTimes(1);

    resetContextManagedDialogs();
    expect(getActiveContextManagedDialog()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
