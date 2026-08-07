'use client';

import { Loader2 } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { buildFileSelectorRows } from './fileSelectorRows';
import { FileSelectorVirtualizedList } from './FileSelectorVirtualizedList';
import type { FileEntry } from './useFileSelector';
import { CommandDialogContent } from '../shared/CommandDialogContent';

import { Command, CommandEmpty, CommandInput, CommandList } from '@/components/ui/command';
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useEscapeToClear } from '@/modules/chatroom/hooks/useEscapeToClear';

interface FileSelectorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: FileEntry[];
  recentFiles?: string[];
  onSelectFile: (filePath: string) => void;
  isLoading?: boolean;
  hasWorkspace?: boolean;
}

export const FileSelectorModal = memo(function FileSelectorModal({
  open,
  onOpenChange,
  files,
  recentFiles = [],
  onSelectFile,
  isLoading,
  hasWorkspace,
}: FileSelectorModalProps) {
  const [search, setSearch] = useState('');
  const searchRef = useRef(search);
  searchRef.current = search;
  const onEscapeKeyDown = useEscapeToClear(searchRef, () => setSearch(''));

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      onOpenChange(newOpen);
    },
    [onOpenChange]
  );

  // Reset search after close — defer to avoid re-rendering list content during exit animation.
  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const handleSelect = useCallback(
    (filePath: string) => {
      onSelectFile(filePath);
      setSearch('');
      onOpenChange(false);
    },
    [onSelectFile, onOpenChange]
  );

  // Manual fuzzy filtering + row building (virtualized list renders only visible rows).
  const rows = useMemo(
    () => buildFileSelectorRows(files, recentFiles, search),
    [files, recentFiles, search]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} modal={false}>
      {/* No overlay — file selector is a quick-picker, not a blocking modal. */}
      <CommandDialogContent
        open={open}
        onEscapeKeyDown={onEscapeKeyDown}
        onBackdropDismiss={() => onOpenChange(false)}
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
            ) : isLoading ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-chatroom-text-muted" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
                  LOADING FILE TREE...
                </span>
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
    </Dialog>
  );
});
