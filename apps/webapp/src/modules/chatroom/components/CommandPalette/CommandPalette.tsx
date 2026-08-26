'use client';

import type { Observable } from '@legendapp/state';
import { useSelector } from '@legendapp/state/react';
import { EyeOff } from 'lucide-react';
import { useState, useEffect, useMemo, useCallback, useRef, useSyncExternalStore } from 'react';

import { CommandOutputModal } from './CommandOutputModal';
import {
  acquireCommandPalettePartition,
  beginCommandPalettePreload,
  commitCommandPalettePreload,
  getCommandPaletteBrowseRows,
  releaseCommandPalettePartition,
  type CommandPalettePartitionState,
} from './commandPalettePartitionStore';
import { buildCommandPaletteRows, type CommandPaletteRow } from './commandPaletteRows';
import { CommandPaletteVirtualizedList } from './CommandPaletteVirtualizedList';
import type { CommandItem } from './types';
import { CommandDialogContent, CommandDialogRoot } from '../shared/CommandDialogContent';

import { Command, CommandEmpty, CommandInput, CommandList } from '@/components/ui/command';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useCommandDialogActions } from '@/modules/chatroom/context/CommandDialogContext';
import {
  getCommandPaletteOpen,
  notifyCommandDialogClosed,
  setCommandPaletteOpen,
  subscribeCommandPaletteOpen,
} from '@/modules/chatroom/context/commandPaletteController';
import { useCommandBlacklist } from '@/modules/chatroom/hooks/useCommandBlacklist';
import { useCommandDialogShortcut } from '@/modules/chatroom/hooks/useCommandDialogShortcut';
import { useCommandRanking } from '@/modules/chatroom/hooks/useCommandRanking';
import type { CommandPaletteOutputState } from '@/modules/chatroom/hooks/useCommandRunOutputV2';
import { sortCommandsByFrecency } from '@/modules/chatroom/lib/sortCommandsByFrecency';

interface CommandPaletteProps {
  chatroomId: string;
  workspaceId: string | null | undefined;
  commands: CommandItem[];
  /** Command palette output state (lifted from parent via useCommandRunOutputV2) */
  inlineCommand: CommandPaletteOutputState;
}

/**
 * Cmd+Shift+P command palette with partition-scoped Legend State preload.
 *
 * Browse rows are precomputed on mount (per chatroomId:workspaceId) and read from
 * the partition store on first open for instant list display.
 */
export function CommandPalette({
  chatroomId,
  workspaceId,
  commands,
  inlineCommand,
}: CommandPaletteProps) {
  const { closeDialog } = useCommandDialogActions();
  const open = useSyncExternalStore(
    subscribeCommandPaletteOpen,
    getCommandPaletteOpen,
    () => false
  );
  const setOpen = useCallback(
    (val: boolean) => {
      if (val) closeDialog();
      setCommandPaletteOpen(val);
      if (!val) notifyCommandDialogClosed();
    },
    [closeDialog]
  );

  const [partitionState$, setPartitionState$] =
    useState<Observable<CommandPalettePartitionState> | null>(null);
  const partitionStateRef = useRef<Observable<CommandPalettePartitionState> | null>(null);

  const [searchValue, setSearchValue] = useState('');
  const searchValueRef = useRef(searchValue);
  searchValueRef.current = searchValue;

  const inlineCommandRef = useRef(inlineCommand);
  inlineCommandRef.current = inlineCommand;

  const handleEscapeKeyDown = useCallback(
    (event: React.KeyboardEvent | KeyboardEvent) => {
      if (searchValueRef.current) {
        event.preventDefault();
        setSearchValue('');
      } else {
        setOpen(false);
      }
    },
    [setOpen]
  );

  const { rankedFilter, trackUsage, frecencyScores, getScore } = useCommandRanking(commands);
  const { blacklistedKeys, blacklist, unblacklist, isBlacklisted } = useCommandBlacklist();

  useEffect(() => {
    if (!open) setSearchValue('');
  }, [open]);

  useCommandDialogShortcut({
    dialog: 'command-palette',
    key: 'p',
    shiftKey: 'required',
  });

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

  const recentCommands = useMemo(() => {
    const withUsage = commands.filter((cmd) => getScore(cmd) > 0);
    return sortCommandsByFrecency(withUsage, frecencyScores);
  }, [commands, getScore, frecencyScores]);

  useEffect(() => {
    if (!chatroomId) return;

    const state$ = acquireCommandPalettePartition(chatroomId, workspaceId);
    partitionStateRef.current = state$;
    setPartitionState$(state$);
    return () => {
      releaseCommandPalettePartition(chatroomId, workspaceId);
      partitionStateRef.current = null;
      setPartitionState$(null);
    };
  }, [chatroomId, workspaceId]);

  useEffect(() => {
    const state$ = partitionStateRef.current;
    if (!state$ || !chatroomId) return;

    const generation = beginCommandPalettePreload(state$);

    const rows = buildCommandPaletteRows({
      commands,
      search: '',
      rankedFilter,
      recentCommands,
      groupedCommands,
      getScore,
      frecencyScores,
      blacklistedKeys,
    });
    commitCommandPalettePreload(state$, generation, rows);
  }, [
    chatroomId,
    commands,
    rankedFilter,
    recentCommands,
    groupedCommands,
    getScore,
    frecencyScores,
    blacklistedKeys,
  ]);

  const { browseRowsFromStore, partitionStatus } = useSelector(() => {
    if (!partitionState$) {
      return { browseRowsFromStore: [] as CommandPaletteRow[], partitionStatus: 'idle' as const };
    }
    const status = partitionState$.status.get();
    const partitionKey = partitionState$.partitionKey.get();
    return {
      partitionStatus: status,
      browseRowsFromStore: status === 'ready' ? getCommandPaletteBrowseRows(partitionKey) : [],
    };
  });

  const rows = useMemo(() => {
    if (!isSearching && partitionStatus === 'ready' && browseRowsFromStore.length > 0) {
      return browseRowsFromStore;
    }
    return buildCommandPaletteRows({
      commands,
      search: searchValue,
      rankedFilter,
      recentCommands,
      groupedCommands,
      getScore,
      frecencyScores,
      blacklistedKeys,
    });
  }, [
    isSearching,
    partitionStatus,
    browseRowsFromStore,
    commands,
    searchValue,
    rankedFilter,
    recentCommands,
    groupedCommands,
    getScore,
    frecencyScores,
    blacklistedKeys,
  ]);

  const handleSelect = useCallback(
    (command: CommandItem) => {
      trackUsage(command);

      if (command.showOutputInline && command.script) {
        inlineCommandRef.current.run(command.label, command.script);
        setOpen(false);
        return;
      }

      // Run the action BEFORE closing so side effects (e.g. openExternalUrl's
      // anchor .click()) stay in the user-gesture stack.
      command.action();
      setOpen(false);
    },
    [trackUsage, setOpen]
  );

  // fallow-ignore-next-line complexity
  const renderCommandItemContent = useCallback(
    (command: CommandItem) => {
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
          {isBlacklisted(command) && (
            <span title="Blacklisted" className="flex-shrink-0">
              <EyeOff className="h-3.5 w-3.5 text-chatroom-text-muted" />
            </span>
          )}
        </>
      );
    },
    [isSearching, getScore, isBlacklisted]
  );

  return (
    <>
      <CommandDialogRoot open={open} onOpenChange={setOpen}>
        <CommandDialogContent
          open={open}
          onEscapeKeyDown={handleEscapeKeyDown}
          onBackdropDismiss={() => setOpen(false)}
        >
          <DialogTitle className="sr-only">Command Palette</DialogTitle>
          <DialogDescription className="sr-only">Search and execute a command</DialogDescription>

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
                <CommandEmpty className="text-chatroom-text-muted text-xs font-bold uppercase tracking-wider px-4">
                  No commands found.
                </CommandEmpty>
                {rows.length > 0 && (
                  <CommandPaletteVirtualizedList
                    rows={rows}
                    onSelect={handleSelect}
                    renderCommandItemContent={renderCommandItemContent}
                    scrollResetKey={searchValue}
                    isBlacklisted={isBlacklisted}
                    onBlacklist={blacklist}
                    onUnblacklist={unblacklist}
                  />
                )}
              </CommandList>
            </Command>
          </div>
        </CommandDialogContent>
      </CommandDialogRoot>
      <CommandOutputModal inlineCommand={inlineCommand} />
    </>
  );
}
