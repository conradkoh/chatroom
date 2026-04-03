'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useEffect, useMemo, useCallback } from 'react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem as CommandItemUI,
  CommandList,
} from '@/components/ui/command';
import { Dialog, DialogPortal } from '@/components/ui/dialog';
import { useTwoFingerTap } from '@/hooks/useTwoFingerTap';
import { cn } from '@/lib/utils';

import { fuzzyFilter } from '@/lib/fuzzyMatch';

import { COMMAND_DIALOG_CONTENT_CLASSES, COMMAND_GROUP_HEADING_CLASSES } from '../shared/commandDialogStyles';
import { useCommandDialog } from '@/modules/chatroom/context/CommandDialogContext';
import type { CommandItem } from './types';

interface CommandPaletteProps {
  commands: CommandItem[];
}

/**
 * Global Cmd+Shift+P command palette.
 *
 * Opens a VSCode-style command palette that allows the user to search and
 * execute commands. Triggered by Cmd+Shift+P (Mac) or Ctrl+Shift+P (Win/Linux).
 * Mount this once inside the authenticated app layout.
 *
 * Uses DialogPrimitive.Content directly (no ShadCN DialogContent wrapper) to:
 * - Avoid the default overlay backdrop (no fade-in lag)
 * - Open instantly (duration-0 on open, smooth fade on close)
 * - Apply the industrial theme cleanly without fighting Tailwind specificity
 */
export function CommandPalette({ commands }: CommandPaletteProps) {
  const { activeDialog, openDialog, closeDialog } = useCommandDialog();
  const open = activeDialog === 'command-palette';
  const setOpen = useCallback(
    (val: boolean) => (val ? openDialog('command-palette') : closeDialog()),
    [openDialog, closeDialog]
  );

  // Two-finger tap on mobile opens the command palette
  const toggleOpen = useCallback(
    () => (open ? closeDialog() : openDialog('command-palette')),
    [open, openDialog, closeDialog]
  );
  useTwoFingerTap(toggleOpen);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const triggerKey = isMac ? e.metaKey : e.ctrlKey;

      if (triggerKey && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        if (open) {
          closeDialog();
        } else {
          openDialog('command-palette');
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, openDialog, closeDialog]);

  // Group commands by category
  const groupedCommands = useMemo(() => {
    const groups = new Map<string, CommandItem[]>();
    for (const command of commands) {
      const existing = groups.get(command.category) ?? [];
      existing.push(command);
      groups.set(command.category, existing);
    }
    return groups;
  }, [commands]);

  const handleSelect = (command: CommandItem) => {
    command.action();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPortal>
        {/* No overlay — command palette is a quick-picker, not a blocking modal. */}
        <DialogPrimitive.Content
          forceMount
          className={cn(...COMMAND_DIALOG_CONTENT_CLASSES)}
        >
          {/* Accessible title and description (sr-only) */}
          <DialogPrimitive.Title className="sr-only">Command Palette</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search and execute a command
          </DialogPrimitive.Description>

          <Command filter={fuzzyFilter} className="bg-chatroom-bg-primary text-chatroom-text-primary">
            <CommandInput
              placeholder="Type a command..."
              className="text-chatroom-text-primary placeholder:text-chatroom-text-muted bg-transparent"
            />
            <CommandList className="min-h-[244px] h-[244px]">
              <CommandEmpty className="text-chatroom-text-muted text-xs font-bold uppercase tracking-wider px-4">
                No commands found.
              </CommandEmpty>
              {Array.from(groupedCommands.entries()).map(([category, items]) => (
                <CommandGroup
                  key={category}
                  heading={category}
                  className={COMMAND_GROUP_HEADING_CLASSES}
                >
                  {items.map((command) => (
                    <CommandItemUI
                      key={command.id}
                      value={command.label}
                      onSelect={() => handleSelect(command)}
                      className="flex flex-row items-center gap-2 rounded-none text-chatroom-text-primary hover:bg-chatroom-bg-hover data-[selected=true]:bg-chatroom-bg-hover data-[selected=true]:text-chatroom-text-primary"
                    >
                      {/* Command icon */}
                      {command.icon && (
                        <span className="flex-shrink-0 text-chatroom-text-muted">
                          {command.icon}
                        </span>
                      )}

                      {/* Command label */}
                      <span className="text-sm font-bold uppercase tracking-wide text-chatroom-text-primary flex-1 truncate">
                        {command.label}
                      </span>

                      {/* Keyboard shortcut */}
                      {command.shortcut && (
                        <span className="text-xs text-chatroom-text-muted font-mono tracking-wide flex-shrink-0">
                          {command.shortcut}
                        </span>
                      )}
                    </CommandItemUI>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
