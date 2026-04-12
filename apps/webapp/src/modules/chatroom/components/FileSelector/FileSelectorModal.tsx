'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Loader2 } from 'lucide-react';
import { memo, useCallback, useState, useRef } from 'react';

import { FileTypeIcon } from './fileIcons';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Dialog, DialogPortal } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

import type { FileEntry } from './useFileSelector';

import { fuzzyFilter } from '@/lib/fuzzyMatch';
import { getFileName, getParentDir } from '@/lib/pathUtils';
import { useEscapeToClear } from '@/modules/chatroom/hooks/useEscapeToClear';
import { COMMAND_DIALOG_CONTENT_CLASSES } from '../shared/commandDialogStyles';

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
      if (!newOpen) {
        setSearch('');
      }
      onOpenChange(newOpen);
    },
    [onOpenChange]
  );

  const handleSelect = useCallback(
    (filePath: string) => {
      onSelectFile(filePath);
      setSearch('');
      onOpenChange(false);
    },
    [onSelectFile, onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPortal>
        {/* No overlay — file selector is a quick-picker, not a blocking modal. */}
        <DialogPrimitive.Content
          forceMount
          onEscapeKeyDown={onEscapeKeyDown}
          className={cn(...COMMAND_DIALOG_CONTENT_CLASSES)}
          style={{ maxHeight: '60vh' }}
        >
          {/* Accessible title and description (sr-only) */}
          <DialogPrimitive.Title className="sr-only">FILE SELECTOR</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search and open workspace files
          </DialogPrimitive.Description>

          <Command
            filter={fuzzyFilter}
            className="bg-chatroom-bg-primary text-chatroom-text-primary"
          >
            {/* u03: Seamless search input with only bottom border, u04: "Go to File..." placeholder */}
            <CommandInput
              placeholder="Go to File..."
              value={search}
              onValueChange={setSearch}
              className="text-chatroom-text-primary placeholder:text-chatroom-text-muted bg-transparent rounded-none border-none h-10 text-sm"
            />
            {/* u10: Dynamic list height, max 50vh, at least 5 items visible */}
            <CommandList className="max-h-[50vh] min-h-[196px]">
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
                  <CommandGroup>
                    {/* Recent files section (only when not searching) */}
                    {recentFiles.length > 0 && !search && (
                      <>
                        <div
                          className="px-2 py-1.5 text-sm font-medium text-chatroom-text-muted"
                          cmdk-group-heading=""
                        >
                          recently opened
                        </div>
                        {recentFiles.map((path) => (
                          <CommandItem
                            key={`recent:${path}`}
                            value={`recent:${path}`}
                            onSelect={() => handleSelect(path)}
                            // u05: Compact 28px height, u07: Full-width solid bg highlight
                            className="flex flex-row items-center gap-2 rounded-none cursor-pointer px-3 py-1 min-h-[28px] text-chatroom-text-primary hover:bg-chatroom-bg-hover data-[selected=true]:bg-chatroom-bg-hover"
                          >
                            <FileTypeIcon
                              path={path}
                              className="h-4 w-4 shrink-0 text-chatroom-text-muted"
                            />
                            {/* u06: File name bold, directory lighter, same row */}
                            <span className="text-sm font-medium truncate flex-1">
                              {getFileName(path)}
                            </span>
                            {getParentDir(path) && (
                              <span className="text-sm text-chatroom-text-muted truncate max-w-[50%]">
                                {getParentDir(path)}
                              </span>
                            )}
                          </CommandItem>
                        ))}
                        <div
                          className="px-2 py-1.5 text-sm font-medium text-chatroom-text-muted"
                          cmdk-group-heading=""
                        >
                          files
                        </div>
                      </>
                    )}
                    {/* Full file list (excluding recent files to avoid duplicates) */}
                    {(() => {
                      const recentSet = new Set(recentFiles);
                      const displayFiles =
                        !search && recentFiles.length > 0
                          ? files.filter((f) => !recentSet.has(f.path))
                          : files;
                      return displayFiles.map((file) => (
                        <CommandItem
                          key={file.path}
                          value={file.path}
                          onSelect={() => handleSelect(file.path)}
                          // u05: Compact 28px height, u07: Full-width solid bg highlight (no left border)
                          className="flex flex-row items-center gap-2 rounded-none cursor-pointer px-3 py-1 min-h-[28px] text-chatroom-text-primary hover:bg-chatroom-bg-hover data-[selected=true]:bg-chatroom-bg-hover"
                        >
                          <FileTypeIcon
                            path={file.path}
                            className="h-4 w-4 shrink-0 text-chatroom-text-muted"
                          />
                          {/* u06: File name bold, directory lighter */}
                          <span className="text-sm font-medium truncate flex-1">
                            {getFileName(file.path)}
                          </span>
                          {/* u08: No file size in search list */}
                          {getParentDir(file.path) && (
                            <span className="text-sm text-chatroom-text-muted truncate max-w-[50%]">
                              {getParentDir(file.path)}
                            </span>
                          )}
                        </CommandItem>
                      ));
                    })()}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
});
