'use client';

/**
 * Shared context for mutual exclusivity across command-style dialogs.
 *
 * Switcher and file-selector open state live in a module-level controller
 * (`contextManagedDialogsController.ts`) so opening Cmd+P/Cmd+K does not
 * rerender `ChatroomDashboard`. Command palette uses its own module-level
 * controller (`commandPaletteController.ts`). This provider only supplies
 * ACTIONS; open state is read via `useSyncExternalStore` in the components
 * that need it (switcher, file selector, shortcut hook).
 */

import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import {
  getCommandPaletteOpen,
  notifyCommandDialogClosed,
  resetCommandPalette,
  setCommandPaletteOpen,
  toggleCommandPaletteOpen,
} from './commandPaletteController';
import {
  closeContextManagedDialog,
  getActiveContextManagedDialog,
  openContextManagedDialog,
  resetContextManagedDialogs,
  subscribeActiveContextManagedDialog,
} from './contextManagedDialogsController';

/** Dialogs managed by the module controller (mutually exclusive with each other + palette). */
export type ContextManagedDialog = 'switcher' | 'file-selector';

/** @deprecated Use ContextManagedDialog — kept for shortcut hook compatibility */
export type CommandDialogType = ContextManagedDialog | 'command-palette' | null;

interface CommandDialogState {
  activeDialog: ContextManagedDialog | null;
}

interface CommandDialogActions {
  openDialog: (dialog: ContextManagedDialog) => void;
  closeDialog: () => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;
}

const CommandDialogActionsContext = createContext<CommandDialogActions | null>(null);

export function CommandDialogProvider({ children }: { children: ReactNode }) {
  const closeDialog = useCallback(() => {
    if (getActiveContextManagedDialog() !== null) notifyCommandDialogClosed();
    closeContextManagedDialog();
  }, []);

  const openDialog = useCallback((dialog: ContextManagedDialog) => {
    if (getCommandPaletteOpen()) {
      setCommandPaletteOpen(false);
      notifyCommandDialogClosed();
    }
    openContextManagedDialog(dialog);
  }, []);

  const openCommandPalette = useCallback(() => {
    closeContextManagedDialog();
    setCommandPaletteOpen(true);
  }, []);

  const closeCommandPalette = useCallback(() => {
    setCommandPaletteOpen(false);
    notifyCommandDialogClosed();
  }, []);

  const toggleCommandPalette = useCallback(() => {
    closeContextManagedDialog();
    const wasOpen = getCommandPaletteOpen();
    toggleCommandPaletteOpen();
    if (wasOpen) notifyCommandDialogClosed();
  }, []);

  const actions = useMemo(
    (): CommandDialogActions => ({
      openDialog,
      closeDialog,
      openCommandPalette,
      closeCommandPalette,
      toggleCommandPalette,
    }),
    [openDialog, closeDialog, openCommandPalette, closeCommandPalette, toggleCommandPalette]
  );

  const pathname = usePathname();
  const prevPathnameRef = useRef(pathname);
  useLayoutEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      prevPathnameRef.current = pathname;
      const paletteWasOpen = getCommandPaletteOpen();
      resetContextManagedDialogs();
      resetCommandPalette();
      if (paletteWasOpen) notifyCommandDialogClosed();
    }
  }, [pathname]);

  return (
    <CommandDialogActionsContext.Provider value={actions}>
      {children}
    </CommandDialogActionsContext.Provider>
  );
}

export function useCommandDialogActions(): CommandDialogActions {
  const ctx = useContext(CommandDialogActionsContext);
  if (!ctx) throw new Error('useCommandDialogActions must be used within CommandDialogProvider');
  return ctx;
}

/** Read switcher/file-selector open state from the module controller (no provider needed). */
// fallow-ignore-next-line unused-export
export function useCommandDialogState(): CommandDialogState {
  const activeDialog = useSyncExternalStore(
    subscribeActiveContextManagedDialog,
    getActiveContextManagedDialog,
    () => null
  );
  return { activeDialog };
}

/** @deprecated Prefer useCommandDialogActions + useCommandDialogState. Kept for gradual migration. */
// fallow-ignore-next-line unused-export
export function useCommandDialog() {
  const state = useCommandDialogState();
  const actions = useCommandDialogActions();
  return { ...state, ...actions };
}
