'use client';

import { useEffect } from 'react';

import {
  type CommandDialogType,
  useCommandDialog,
} from '@/modules/chatroom/context/CommandDialogContext';

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

/**
 * Registers a global keyboard shortcut that toggles a command dialog open/closed.
 * Used by Cmd+K (switcher), Cmd+P (file selector), and Cmd+Shift+P (command palette).
 */
export function useCommandDialogShortcut({
  dialog,
  key,
  shiftKey = 'ignored',
}: CommandDialogShortcutOptions): void {
  const { activeDialog, openDialog, closeDialog } = useCommandDialog();
  const open = activeDialog === dialog;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!matchesCommandDialogShortcut(event, { key, shiftKey })) return;

      event.preventDefault();
      if (open) {
        closeDialog();
      } else {
        openDialog(dialog);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, openDialog, closeDialog, dialog, key, shiftKey]);
}
