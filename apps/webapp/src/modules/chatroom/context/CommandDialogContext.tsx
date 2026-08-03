'use client';

/**
 * Shared context for mutual exclusivity across command-style dialogs.
 *
 * Only one command dialog (Cmd+K switcher, Cmd+P file selector, Cmd+Shift+P
 * command palette) can be open at a time. Opening one auto-closes any other.
 */

import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type CommandDialogType = 'switcher' | 'file-selector' | 'command-palette' | null;

interface CommandDialogContextValue {
  activeDialog: CommandDialogType;
  openDialog: (dialog: CommandDialogType) => void;
  closeDialog: () => void;
}

const CommandDialogContext = createContext<CommandDialogContextValue | null>(null);

export function CommandDialogProvider({ children }: { children: ReactNode }) {
  const [activeDialog, setActiveDialog] = useState<CommandDialogType>(null);

  const openDialog = useCallback((dialog: CommandDialogType) => {
    setActiveDialog(dialog);
  }, []);

  const closeDialog = useCallback(() => {
    setActiveDialog(null);
  }, []);

  // Reset open dialog on route change so a stale `activeDialog` cannot leave a
  // force-mounted dialog in `data-state=open` after back navigation or unmount
  // without closeDialog() being called. `useLayoutEffect` closes before paint.
  const pathname = usePathname();
  const prevPathnameRef = useRef(pathname);
  useLayoutEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      prevPathnameRef.current = pathname;
      setActiveDialog(null);
    }
  }, [pathname]);

  return (
    <CommandDialogContext.Provider value={{ activeDialog, openDialog, closeDialog }}>
      {children}
    </CommandDialogContext.Provider>
  );
}

export function useCommandDialog() {
  const ctx = useContext(CommandDialogContext);
  if (!ctx) throw new Error('useCommandDialog must be used within CommandDialogProvider');
  return ctx;
}
