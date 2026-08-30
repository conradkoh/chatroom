'use client';

import { Loader2 } from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { buildFileSelectorRows } from './fileSelectorRows';
import { FileSelectorVirtualizedList } from './FileSelectorVirtualizedList';
import type { FileEntry } from './useFileSelector';
import { CommandDialogContent, CommandDialogRoot } from '../shared/CommandDialogContent';

import { Command, CommandEmpty, CommandInput, CommandList } from '@/components/ui/command';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useCommandDialogActions } from '@/modules/chatroom/context/CommandDialogContext';
import {
  getFileSelectorOpen,
  openContextManagedDialog,
  subscribeActiveContextManagedDialog,
} from '@/modules/chatroom/context/contextManagedDialogsController';
import { useCommandDialogShortcut } from '@/modules/chatroom/hooks/useCommandDialogShortcut';
import { useEscapeToClear } from '@/modules/chatroom/hooks/useEscapeToClear';

export interface FileSelectorModalProps {
  files: FileEntry[];
  recentFiles: string[];
  onSelectFile: (filePath: string) => void;
  isLoading: boolean;
  isSyncing: boolean;
  isNeverSynced: boolean;
  loadError: string | null;
  hasWorkspace: boolean;
  /** Refreshes the file tree when the picker opens. */
  onRefresh: (options?: { force?: boolean }) => void;
}

// fallow-ignore-next-line complexity
export const FileSelectorModal = memo(function FileSelectorModal({
  files,
  recentFiles,
  onSelectFile,
  isLoading,
  isSyncing,
  isNeverSynced,
  loadError,
  hasWorkspace,
  onRefresh,
}: FileSelectorModalProps) {
  const { closeDialog } = useCommandDialogActions();
  const open = useSyncExternalStore(
    subscribeActiveContextManagedDialog,
    getFileSelectorOpen,
    () => false
  );

  const [search, setSearch] = useState('');
  const searchRef = useRef(search);
  searchRef.current = search;
  const onEscapeKeyDown = useEscapeToClear(searchRef, () => setSearch(''));

  // Register Cmd+P / Ctrl+P shortcut (preventDefault blocks browser print dialog)
  useCommandDialogShortcut({ dialog: 'file-selector', key: 'p', shiftKey: 'forbidden' });

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (newOpen) openContextManagedDialog('file-selector');
      else closeDialog();
    },
    [closeDialog]
  );

  // Refresh the file tree on open (deferred to avoid blocking open animation).
  useEffect(() => {
    if (!open || !hasWorkspace) return;
    const frame = requestAnimationFrame(() => {
      if (getFileSelectorOpen()) onRefresh();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, hasWorkspace, onRefresh]);

  // Reset search after close — defer to avoid re-rendering list content during exit animation.
  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const handleSelect = useCallback(
    (filePath: string) => {
      onSelectFile(filePath);
      setSearch('');
      closeDialog();
    },
    [onSelectFile, closeDialog]
  );

  // Manual fuzzy filtering + row building (virtualized list renders only visible rows).
  const rows = useMemo(
    () => buildFileSelectorRows(files, recentFiles, search),
    [files, recentFiles, search]
  );

  return (
    <CommandDialogRoot open={open} onOpenChange={handleOpenChange}>
      {/* No overlay — file selector is a quick-picker, not a blocking modal. */}
      <CommandDialogContent
        open={open}
        onEscapeKeyDown={onEscapeKeyDown}
        onBackdropDismiss={() => closeDialog()}
        style={{ maxHeight: '60vh' }}
      >
        {/* Accessible title and description (sr-only) */}
        <DialogTitle className="sr-only">FILE SELECTOR</DialogTitle>
        <DialogDescription className="sr-only">Search and open workspace files</DialogDescription>

        <Command shouldFilter={false} className="bg-chatroom-bg-primary text-chatroom-text-primary">
          {/* u03: Seamless search input with only bottom border, u04: "Go to File..." placeholder */}
          <CommandInput
            placeholder="Go to File..."
            value={search}
            onValueChange={setSearch}
            className="text-chatroom-text-primary placeholder:text-chatroom-text-muted bg-transparent rounded-none border-none h-10 text-sm"
          />
          {/* u10: Fixed height container to prevent input box position shift */}
          <CommandList className="min-h-[196px] h-[196px] p-0 overflow-hidden">
            {!hasWorkspace ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-chatroom-text-muted">
                  NO WORKSPACE CONNECTED
                </span>
                <span className="text-[10px] text-chatroom-text-muted">
                  Start a daemon to browse files
                </span>
              </div>
            ) : isLoading || isSyncing ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-chatroom-text-muted" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
                  {isSyncing ? 'SYNCING FILE TREE...' : 'LOADING FILE TREE...'}
                </span>
              </div>
            ) : loadError ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3 px-4 text-center">
                <span className="text-[10px] text-chatroom-text-muted">{loadError}</span>
                <button
                  type="button"
                  className="rounded border border-chatroom-border px-3 py-1 text-[10px] text-chatroom-text hover:bg-chatroom-surface-hover"
                  onClick={() => onRefresh({ force: true })}
                >
                  Retry
                </button>
              </div>
            ) : isNeverSynced && files.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3 px-4 text-center">
                <span className="text-[10px] text-chatroom-text-muted">
                  Workspace files haven&apos;t synced yet.
                </span>
                <button
                  type="button"
                  className="rounded border border-chatroom-border px-3 py-1 text-[10px] text-chatroom-text hover:bg-chatroom-surface-hover"
                  onClick={() => onRefresh()}
                >
                  Sync now
                </button>
              </div>
            ) : (
              <>
                <CommandEmpty className="text-chatroom-text-muted text-xs font-bold uppercase tracking-wider px-4 py-6">
                  NO FILES FOUND
                </CommandEmpty>
                {rows.some((row) => row.type === 'item') && (
                  <FileSelectorVirtualizedList
                    rows={rows}
                    onSelect={handleSelect}
                    scrollResetKey={search}
                  />
                )}
              </>
            )}
          </CommandList>
        </Command>
      </CommandDialogContent>
    </CommandDialogRoot>
  );
});
