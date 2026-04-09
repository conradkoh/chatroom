'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';

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

import { COMMAND_DIALOG_CONTENT_CLASSES, COMMAND_GROUP_HEADING_CLASSES } from '../shared/commandDialogStyles';
import { useCommandDialog } from '@/modules/chatroom/context/CommandDialogContext';
import { useCommandRanking } from '@/modules/chatroom/hooks/useCommandRanking';
import { useEscapeToClear } from '@/modules/chatroom/hooks/useEscapeToClear';
import type { CommandItem } from './types';

interface CommandPaletteProps {
  commands: CommandItem[];
}

/**
 * Global Cmd+Shift+P command palette.
 *
 * - **Browse mode** (no search text): commands grouped by category
 * - **Search mode** (typing): flat list ranked by frécency
 */
export function CommandPalette({ commands }: CommandPaletteProps) {
  const { activeDialog, openDialog, closeDialog } = useCommandDialog();
  const open = activeDialog === 'command-palette';
  const setOpen = useCallback(
    (val: boolean) => (val ? openDialog('command-palette') : closeDialog()),
    [openDialog, closeDialog]
  );

  const [searchValue, setSearchValue] = useState('');
  const searchValueRef = useRef(searchValue);
  searchValueRef.current = searchValue;
  const onEscapeKeyDown = useEscapeToClear(searchValueRef, () => setSearchValue(''));

  // Frécency-boosted ranking
  const { rankedFilter, trackUsage, frecencyScores } = useCommandRanking();

  // Two-finger tap on mobile opens the command palette
  const toggleOpen = useCallback(
    () => (open ? closeDialog() : openDialog('command-palette')),
    [open, openDialog, closeDialog]
  );
  useTwoFingerTap(toggleOpen);

  // Reset search when closing
  useEffect(() => {
    if (!open) setSearchValue('');
  }, [open]);

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

  // Group commands by category (for browse mode)
  const groupedCommands = useMemo(() => {
    const groups = new Map<string, CommandItem[]>();
    for (const command of commands) {
      const existing = groups.get(command.category) ?? [];
      existing.push(command);
      groups.set(command.category, existing);
    }
    return groups;
  }, [commands]);

  const isSearching = searchValue.trim().length > 0;

  const handleSelect = (command: CommandItem) => {
    trackUsage(command.label);
    closeDialog();
    setTimeout(() => command.action(), 0);
  };

  const renderCommandItem = (command: CommandItem) => (
    <CommandItemUI
      key={command.id}
      value={command.label}
      keywords={command.keywords}
      onSelect={() => handleSelect(command)}
      className="flex flex-row items-center gap-2 rounded-none cursor-pointer text-chatroom-text-primary hover:bg-chatroom-bg-hover data-[selected=true]:bg-chatroom-bg-hover data-[selected=true]:text-chatroom-text-primary"
    >
      {command.icon && (
        <span className="flex-shrink-0 text-chatroom-text-muted">
          {command.icon}
        </span>
      )}
      <span className="flex-1 min-w-0">
        <span className="text-sm font-bold uppercase tracking-wide text-chatroom-text-primary block truncate">
          {command.label}
        </span>
        {command.detail && (
          <span className="text-[10px] text-chatroom-text-muted block truncate">
            {command.detail}
          </span>
        )}
      </span>
      {command.shortcut && (
        <span className="text-xs text-chatroom-text-muted font-mono tracking-wide flex-shrink-0">
          {command.shortcut}
        </span>
      )}
      {!isSearching && (frecencyScores.get(command.label) ?? 0) > 0 && (
        <span
          className="w-1.5 h-1.5 rounded-full bg-blue-500/60 flex-shrink-0"
          title="Recently used"
        />
      )}
    </CommandItemUI>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPortal>
        <DialogPrimitive.Content
          forceMount
          onEscapeKeyDown={onEscapeKeyDown}
          className={cn(...COMMAND_DIALOG_CONTENT_CLASSES)}
        >
          <DialogPrimitive.Title className="sr-only">Command Palette</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search and execute a command
          </DialogPrimitive.Description>

          <Command filter={rankedFilter} className="bg-chatroom-bg-primary text-chatroom-text-primary">
            <CommandInput
              placeholder="Type a command..."
              className="text-chatroom-text-primary placeholder:text-chatroom-text-muted bg-transparent"
              value={searchValue}
              onValueChange={setSearchValue}
            />
            <CommandList className="min-h-[244px] h-[244px]">
              <CommandEmpty className="text-chatroom-text-muted text-xs font-bold uppercase tracking-wider px-4">
                No commands found.
              </CommandEmpty>

              {isSearching ? (
                /* Search mode: flat list, ranked by frécency */
                <CommandGroup>
                  {commands.map(renderCommandItem)}
                </CommandGroup>
              ) : (
                /* Browse mode: grouped by category */
                Array.from(groupedCommands.entries()).map(([category, items]) => (
                  <CommandGroup
                    key={category}
                    heading={category}
                    className={COMMAND_GROUP_HEADING_CLASSES}
                  >
                    {items.map(renderCommandItem)}
                  </CommandGroup>
                ))
              )}
            </CommandList>
          </Command>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
