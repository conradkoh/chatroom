'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

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
