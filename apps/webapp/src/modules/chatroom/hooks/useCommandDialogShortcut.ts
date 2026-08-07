'use client';

import { useEffect, useSyncExternalStore } from 'react';

import {
  type CommandDialogType,
  useCommandDialogActions,
} from '@/modules/chatroom/context/CommandDialogContext';
import {
  getCommandPaletteOpen,
  subscribeCommandPaletteOpen,
} from '@/modules/chatroom/context/commandPaletteController';
import {
  getActiveContextManagedDialog,
  subscribeActiveContextManagedDialog,
} from '@/modules/chatroom/context/contextManagedDialogsController';

type CommandDialogShiftKey = 'required' | 'forbidden' | 'ignored';

export interface CommandDialogShortcutOptions {
  dialog: NonNullable<CommandDialogType>;
  key: string;
  shiftKey?: CommandDialogShiftKey;
}

// fallow-ignore-next-line complexity
function matchesCommandDialogShortcut(
  event: KeyboardEvent,
  { key, shiftKey = 'ignored' }: Pick<CommandDialogShortcutOptions, 'key' | 'shiftKey'>
): boolean {
  const isMac = navigator.platform.toUpperCase().includes('MAC');
  const modifierPressed = isMac ? event.metaKey : event.ctrlKey;
  if (!modifierPressed) return false;

  if (event.key.toLowerCase() !== key.toLowerCase()) return false;

  switch (shiftKey) {
    case 'required':
      return event.shiftKey;
    case 'forbidden':
      return !event.shiftKey;
    case 'ignored':
    default:
      return true;
  }
}

const noopSubscribe = () => () => {};

/**
 * Registers a global keyboard shortcut that toggles a command dialog open/closed.
 * Used by Cmd+K (switcher), Cmd+P (file selector), and Cmd+Shift+P (command palette).
 */
// fallow-ignore-next-line complexity
export function useCommandDialogShortcut({
  dialog,
  key,
  shiftKey = 'ignored',
}: CommandDialogShortcutOptions): void {
  const { openDialog, closeDialog, toggleCommandPalette } = useCommandDialogActions();
  const contextManagedOpen = useSyncExternalStore(
    dialog === 'command-palette' ? noopSubscribe : subscribeActiveContextManagedDialog,
    () => (dialog === 'command-palette' ? false : getActiveContextManagedDialog() === dialog),
    () => false
  );
  const paletteOpen = useSyncExternalStore(
    dialog === 'command-palette' ? subscribeCommandPaletteOpen : noopSubscribe,
    dialog === 'command-palette' ? getCommandPaletteOpen : () => false,
    () => false
  );
  const open = dialog === 'command-palette' ? paletteOpen : contextManagedOpen;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!matchesCommandDialogShortcut(event, { key, shiftKey })) return;

      if (dialog === 'command-palette') {
        event.preventDefault();
        toggleCommandPalette();
        return;
      }

      event.preventDefault();
      if (open) {
        closeDialog();
      } else {
        openDialog(dialog);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, openDialog, closeDialog, toggleCommandPalette, dialog, key, shiftKey]);
}
