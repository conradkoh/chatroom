'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';

import { CommandOutputModal } from './CommandOutputModal';
import { buildCommandPaletteRows } from './commandPaletteRows';
import { CommandPaletteVirtualizedList } from './CommandPaletteVirtualizedList';
import type { CommandItem } from './types';
import { COMMAND_DIALOG_CONTENT_CLASSES } from '../shared/commandDialogStyles';

import { Command, CommandEmpty, CommandInput, CommandList } from '@/components/ui/command';
import { Dialog, DialogPortal } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useCommandDialog } from '@/modules/chatroom/context/CommandDialogContext';
import { useCommandDialogShortcut } from '@/modules/chatroom/hooks/useCommandDialogShortcut';
import { useCommandRanking } from '@/modules/chatroom/hooks/useCommandRanking';
import type { CommandPaletteOutputState } from '@/modules/chatroom/hooks/useCommandRunOutputV2';
import { sortCommandsByFrecency } from '@/modules/chatroom/lib/sortCommandsByFrecency';

interface CommandPaletteProps {
  commands: CommandItem[];
  /** Command palette output state (lifted from parent via useCommandRunOutputV2) */
  inlineCommand: CommandPaletteOutputState;
}

/**
 * Global Cmd+Shift+P command palette.
 *
 * - **Browse mode** (no search text): commands grouped by category
 * - **Search mode** (typing): flat list ranked by frécency
 */
export function CommandPalette({ commands, inlineCommand }: CommandPaletteProps) {
  const { activeDialog, openDialog, closeDialog } = useCommandDialog();
  const open = activeDialog === 'command-palette';
  const setOpen = useCallback(
    (val: boolean) => (val ? openDialog('command-palette') : closeDialog()),
    [openDialog, closeDialog]
  );

  const [searchValue, setSearchValue] = useState('');
  const searchValueRef = useRef(searchValue);
  searchValueRef.current = searchValue;

  const inlineCommandRef = useRef(inlineCommand);
  inlineCommandRef.current = inlineCommand;

  // Custom escape handler:
  //   1st press — clear search
  //   2nd press — close dialog
  const handleEscapeKeyDown = useCallback(
    (event: React.KeyboardEvent | KeyboardEvent) => {
      if (searchValueRef.current) {
        event.preventDefault();
        setSearchValue('');
      } else {
        closeDialog();
      }
    },
    [closeDialog]
  );

  // Frécency-boosted ranking with command-aware keys and refresh
  const { rankedFilter, trackUsage, frecencyScores, getScore } = useCommandRanking(commands);

  // Reset search when closing
  useEffect(() => {
    if (!open) setSearchValue('');
  }, [open]);

  useCommandDialogShortcut({
    dialog: 'command-palette',
    key: 'p',
    shiftKey: 'required',
  });

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

  // Get recently used commands (frecency > 0) sorted by frecency desc for browse mode
  const recentCommands = useMemo(() => {
    const withUsage = commands.filter((cmd) => getScore(cmd) > 0);
    return sortCommandsByFrecency(withUsage, frecencyScores);
  }, [commands, getScore, frecencyScores]);

  const rows = useMemo(
    () =>
      buildCommandPaletteRows({
        commands,
        search: searchValue,
        rankedFilter,
        recentCommands,
        groupedCommands,
        getScore,
        frecencyScores,
      }),
    [commands, searchValue, rankedFilter, recentCommands, groupedCommands, getScore, frecencyScores]
  );

  const handleSelect = useCallback(
    (command: CommandItem) => {
      trackUsage(command);

      if (command.showOutputInline && command.script) {
        inlineCommandRef.current.run(command.label, command.script);
        closeDialog();
        return;
      }

      // Normal command: close dialog and execute action synchronously so it runs
      // within the iOS user-gesture context. Deferring via setTimeout breaks iOS's
      // gesture chain and causes external URLs to open in an in-app WKWebView
      // instead of the system browser.
      closeDialog();
      command.action();
    },
    [trackUsage, closeDialog]
  );

  const renderCommandItemContent = useCallback(
    (command: CommandItem) => {
      // Returns the content nodes (without the CommandItemUI wrapper) for the virtual list.
      // The virtual list renders its own item wrapper for keyboard nav compatibility.
      return (
        <>
          {command.icon && (
            <span className="flex-shrink-0 text-chatroom-text-muted">{command.icon}</span>
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
          {!isSearching && getScore(command) > 0 && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-blue-500/60 flex-shrink-0"
              title="Recently used"
            />
          )}
          {command.secondaryActions && command.secondaryActions.length > 0 && (
            <span className="flex items-center gap-1 flex-shrink-0">
              {command.secondaryActions.map((sa) => (
                <button
                  key={sa.id}
                  type="button"
                  title={sa.label}
                  onClick={(e) => {
                    e.stopPropagation();
                    sa.action();
                  }}
                  className="p-1 text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-primary transition-colors"
                >
                  {sa.icon ?? sa.label}
                </button>
              ))}
            </span>
          )}
        </>
      );
    },
    [isSearching, getScore]
  );

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen} modal={false}>
        <DialogPortal>
          <DialogPrimitive.Content
            forceMount
            onEscapeKeyDown={handleEscapeKeyDown}
            className={cn(...COMMAND_DIALOG_CONTENT_CLASSES)}
          >
            <DialogPrimitive.Title className="sr-only">Command Palette</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Search and execute a command
            </DialogPrimitive.Description>

            {/* Command list section */}
            <div className="flex flex-col w-full">
              <Command
                shouldFilter={false}
                className="bg-chatroom-bg-primary text-chatroom-text-primary"
              >
                <CommandInput
                  placeholder="Type a command..."
                  className="text-chatroom-text-primary placeholder:text-chatroom-text-muted bg-transparent"
                  value={searchValue}
                  onValueChange={setSearchValue}
                />
                <CommandList className="min-h-[244px] h-[244px] p-0 overflow-hidden">
                  {rows.length === 0 && (
                    <CommandEmpty className="text-chatroom-text-muted text-xs font-bold uppercase tracking-wider px-4">
                      No commands found.
                    </CommandEmpty>
                  )}
                  <CommandPaletteVirtualizedList
                    rows={rows}
                    onSelect={handleSelect}
                    renderCommandItemContent={renderCommandItemContent}
                  />
                </CommandList>
              </Command>
            </div>
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>
      <CommandOutputModal inlineCommand={inlineCommand} />
    </>
  );
}
