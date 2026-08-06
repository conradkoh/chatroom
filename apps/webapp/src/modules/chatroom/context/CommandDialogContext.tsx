'use client';

/**
 * Shared context for mutual exclusivity across command-style dialogs.
 *
 * Switcher and file selector share context state. Command palette uses a
 * module-level controller so opening it does not rerender ChatroomDashboard.
 */

import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  getCommandPaletteOpen,
  notifyCommandDialogClosed,
  resetCommandPalette,
  setCommandPaletteOpen,
  toggleCommandPaletteOpen,
} from './commandPaletteController';

/** Dialogs managed by shared context state (mutually exclusive with each other + palette). */
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

const CommandDialogStateContext = createContext<CommandDialogState | null>(null);
const CommandDialogActionsContext = createContext<CommandDialogActions | null>(null);

export function CommandDialogProvider({ children }: { children: ReactNode }) {
  const [activeDialog, setActiveDialog] = useState<ContextManagedDialog | null>(null);

  const closeDialog = useCallback(() => {
    setActiveDialog((prev) => {
      if (prev !== null) notifyCommandDialogClosed();
      return null;
    });
  }, []);

  const openDialog = useCallback((dialog: ContextManagedDialog) => {
    if (getCommandPaletteOpen()) {
      setCommandPaletteOpen(false);
      notifyCommandDialogClosed();
    }
    setActiveDialog(dialog);
  }, []);

  const openCommandPalette = useCallback(() => {
    setActiveDialog(null);
    setCommandPaletteOpen(true);
  }, []);

  const closeCommandPalette = useCallback(() => {
    setCommandPaletteOpen(false);
    notifyCommandDialogClosed();
  }, []);

  const toggleCommandPalette = useCallback(() => {
    setActiveDialog(null);
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
      setActiveDialog(null);
      resetCommandPalette();
      if (paletteWasOpen) notifyCommandDialogClosed();
    }
  }, [pathname]);

  const state = useMemo(() => ({ activeDialog }), [activeDialog]);

  return (
    <CommandDialogActionsContext.Provider value={actions}>
      <CommandDialogStateContext.Provider value={state}>
        {children}
      </CommandDialogStateContext.Provider>
    </CommandDialogActionsContext.Provider>
  );
}

export function useCommandDialogActions(): CommandDialogActions {
  const ctx = useContext(CommandDialogActionsContext);
  if (!ctx) throw new Error('useCommandDialogActions must be used within CommandDialogProvider');
  return ctx;
}

export function useCommandDialogState(): CommandDialogState {
  const ctx = useContext(CommandDialogStateContext);
  if (!ctx) throw new Error('useCommandDialogState must be used within CommandDialogProvider');
  return ctx;
}

/** @deprecated Prefer useCommandDialogActions + useCommandDialogState. Kept for gradual migration. */
export function useCommandDialog() {
  const state = useCommandDialogState();
  const actions = useCommandDialogActions();
  return { ...state, ...actions };
}
