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

import {
  COMMAND_DIALOG_CONTENT_CLASSES,
  COMMAND_DIALOG_SPLIT_CONTENT_CLASSES,
  COMMAND_GROUP_HEADING_CLASSES,
} from '../shared/commandDialogStyles';
import { useCommandDialog } from '@/modules/chatroom/context/CommandDialogContext';
import { useCommandRanking } from '@/modules/chatroom/hooks/useCommandRanking';
import type { CommandItem, RunnableCommandHandle } from './types';
import { CommandOutputPanel } from './CommandOutputPanel';

interface CommandPaletteProps {
  commands: CommandItem[];
}

/** Maximum number of output lines to keep in buffer to prevent memory issues */
const MAX_OUTPUT_LINES = 1000;

/** State for a running command with inline output */
interface RunningCommandState {
  command: CommandItem;
  handle: RunnableCommandHandle;
  output: string[];
  isRunning: boolean;
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

  // State for inline command output
  const [runningCommand, setRunningCommand] = useState<RunningCommandState | null>(null);
  const outputUnsubscribeRef = useRef<(() => void) | null>(null);

  // Custom escape handler: first press closes output panel, second press closes dialog
  const handleEscapeKeyDown = useCallback(
    (event: React.KeyboardEvent | KeyboardEvent) => {
      if (runningCommand) {
        // First escape: close output panel only
        event.preventDefault();
        // Clean up subscription
        if (outputUnsubscribeRef.current) {
          outputUnsubscribeRef.current();
          outputUnsubscribeRef.current = null;
        }
        // Stop the running command
        runningCommand.handle.stop();
        setRunningCommand(null);
      } else if (searchValueRef.current) {
        // Second escape (or when no output panel): clear search
        event.preventDefault();
        setSearchValue('');
      } else {
        // Third escape: close dialog
        closeDialog();
      }
    },
    [runningCommand, closeDialog]
  );

  // Clean up on dialog close
  useEffect(() => {
    if (!open) {
      if (outputUnsubscribeRef.current) {
        outputUnsubscribeRef.current();
        outputUnsubscribeRef.current = null;
      }
      if (runningCommand) {
        runningCommand.handle.stop();
        setRunningCommand(null);
      }
      setSearchValue('');
    }
  }, [open, runningCommand]);

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

  // Get recently used commands (frecency > 0) for browse mode
  const recentCommands = useMemo(() => {
    return commands.filter((cmd) => (frecencyScores.get(cmd.label) ?? 0) > 0);
  }, [commands, frecencyScores]);

  const handleSelect = useCallback(
    (command: CommandItem) => {
      trackUsage(command.label);

      // If command wants to show output inline, handle it specially
      if (command.showOutputInline && command.runAction) {
        // Clean up any existing subscription
        if (outputUnsubscribeRef.current) {
          outputUnsubscribeRef.current();
          outputUnsubscribeRef.current = null;
        }

        // Stop any existing running command
        if (runningCommand) {
          runningCommand.handle.stop();
        }

        // Start the new command
        const handle = command.runAction();
        const newRunningState: RunningCommandState = {
          command,
          handle,
          output: [],
          isRunning: true,
        };
        setRunningCommand(newRunningState);

        // Subscribe to output updates with error handling
        try {
          const unsubscribe = handle.onOutput((lines) => {
            setRunningCommand((prev) =>
              prev
                ? {
                    ...prev,
                    output: lines.slice(-MAX_OUTPUT_LINES),
                    isRunning: handle.isRunning(),
                  }
                : null
            );
          });
          outputUnsubscribeRef.current = unsubscribe;
        } catch (err) {
          console.error('Failed to subscribe to command output:', err);
          setRunningCommand((prev) => (prev ? { ...prev, isRunning: false } : null));
        }

        return;
      }

      // Normal command: close dialog and execute
      closeDialog();
      setTimeout(() => command.action(), 0);
    },
    [trackUsage, closeDialog, runningCommand]
  );

  // Handle stop command
  const handleStopCommand = useCallback(() => {
    if (runningCommand) {
      runningCommand.handle.stop();
      setRunningCommand((prev) => (prev ? { ...prev, isRunning: false } : null));
    }
  }, [runningCommand]);

  // Handle run again
  const handleRunAgain = useCallback(() => {
    if (runningCommand) {
      handleSelect(runningCommand.command);
    }
  }, [runningCommand, handleSelect]);

  // Handle close output panel
  const handleCloseOutputPanel = useCallback(() => {
    if (outputUnsubscribeRef.current) {
      outputUnsubscribeRef.current();
      outputUnsubscribeRef.current = null;
    }
    if (runningCommand) {
      runningCommand.handle.stop();
    }
    setRunningCommand(null);
  }, [runningCommand]);

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

  // Determine which dialog classes to use based on whether output panel is shown
  const dialogClasses = runningCommand
    ? COMMAND_DIALOG_SPLIT_CONTENT_CLASSES
    : COMMAND_DIALOG_CONTENT_CLASSES;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPortal>
        <DialogPrimitive.Content
          forceMount
          onEscapeKeyDown={handleEscapeKeyDown}
          className={cn(...dialogClasses)}
        >
          <DialogPrimitive.Title className="sr-only">Command Palette</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search and execute a command
          </DialogPrimitive.Description>

          {/* Command list section */}
          <div className={cn('flex flex-col', runningCommand ? 'w-[400px]' : 'w-full')}>
            <Command
              filter={rankedFilter}
              className="bg-chatroom-bg-primary text-chatroom-text-primary"
            >
              <CommandInput
                placeholder="Type a command..."
                className="text-chatroom-text-primary placeholder:text-chatroom-text-muted bg-transparent"
                value={searchValue}
                onValueChange={setSearchValue}
              />
              <CommandList
                className={cn(runningCommand ? 'min-h-[300px] h-[300px]' : 'min-h-[244px] h-[244px]')}
              >
                <CommandEmpty className="text-chatroom-text-muted text-xs font-bold uppercase tracking-wider px-4">
                  No commands found.
                </CommandEmpty>

                {isSearching ? (
                  /* Search mode: flat list, ranked by frécency */
                  <CommandGroup>
                    {commands.map(renderCommandItem)}
                  </CommandGroup>
                ) : (
                  /* Browse mode: Recent section at top, then grouped by category */
                  <>
                    {recentCommands.length > 0 && (
                      <CommandGroup heading="Recent" className={COMMAND_GROUP_HEADING_CLASSES}>
                        {recentCommands.map(renderCommandItem)}
                      </CommandGroup>
                    )}
                    {Array.from(groupedCommands.entries()).map(([category, items]) => {
                      // In browse mode, skip items already shown in Recent
                      const itemsToShow =
                        recentCommands.length > 0
                          ? items.filter((item) => (frecencyScores.get(item.label) ?? 0) === 0)
                          : items;
                      if (itemsToShow.length === 0) return null;
                      return (
                        <CommandGroup
                          key={category}
                          heading={category}
                          className={COMMAND_GROUP_HEADING_CLASSES}
                        >
                          {itemsToShow.map(renderCommandItem)}
                        </CommandGroup>
                      );
                    })}
                  </>
                )}
              </CommandList>
            </Command>
          </div>

          {/* Output panel section - shown when a runnable command is active */}
          {runningCommand && (
            <div className="flex-1 min-w-[400px]">
              <CommandOutputPanel
                commandName={runningCommand.command.label}
                isRunning={runningCommand.isRunning}
                output={runningCommand.output}
                onStop={handleStopCommand}
                onRunAgain={handleRunAgain}
                onClose={handleCloseOutputPanel}
              />
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
