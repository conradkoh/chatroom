'use client';

import { Loader2 } from 'lucide-react';
import { memo, useCallback, useState } from 'react';

import { FileTypeIcon } from './fileIcons';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import type { FileEntry } from './useFileSelector';

interface FileSelectorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: FileEntry[];
  recentFiles?: string[];
  onSelectFile: (filePath: string) => void;
  isLoading?: boolean;
  hasWorkspace?: boolean;
}

/** Extract filename from a path for display. */
function getFileName(path: string): string {
  return path.split('/').pop() ?? path;
}

/** Get parent directory for display. */
function getParentDir(path: string): string {
  const parts = path.split('/');
  if (parts.length <= 1) return '';
  return parts.slice(0, -1).join('/');
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
      <DialogHeader className="sr-only">
        <DialogTitle>FILE SELECTOR</DialogTitle>
        <DialogDescription>Search and open workspace files</DialogDescription>
      </DialogHeader>
      {/* u01: Position at top ~20% of viewport, u02: Fixed width ~600px */}
      <DialogContent
        className="w-[600px] max-w-[90vw] rounded-none border border-chatroom-border bg-chatroom-bg-primary p-0 shadow-lg overflow-hidden fixed top-[20%] translate-y-0 left-[50%] translate-x-[-50%]"
        style={{ maxHeight: '60vh' }}
      >
        <Command className="bg-chatroom-bg-primary text-chatroom-text-primary">
          {/* u03: Seamless search input with only bottom border, u04: "Go to File..." placeholder */}
          <CommandInput
            placeholder="Go to File..."
            value={search}
            onValueChange={setSearch}
            className="text-chatroom-text-primary placeholder:text-chatroom-text-muted bg-transparent rounded-none border-none h-10 text-sm"
          />
          {/* u10: Dynamic list height, max 50vh, at least 5 items visible */}
          <CommandList className="max-h-[50vh] min-h-[160px]">
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
                {recentFiles.length > 0 && !search && (
                  <CommandGroup heading="RECENT">
                    {recentFiles.map((path) => (
                      <CommandItem
                        key={`recent:${path}`}
                        value={path}
                        onSelect={() => handleSelect(path)}
                        // u05: Compact 28px height, u07: Full-width solid bg highlight
                        className="flex flex-row items-center gap-2 rounded-none px-3 py-1 min-h-[28px] text-chatroom-text-primary hover:bg-chatroom-bg-hover data-[selected=true]:bg-chatroom-bg-hover"
                      >
                        <FileTypeIcon path={path} className="h-4 w-4 shrink-0 text-chatroom-text-muted" />
                        {/* u06: File name bold, directory lighter, same row */}
                        <span className="text-sm font-medium truncate flex-1">
                          {getFileName(path)}
                        </span>
                        {getParentDir(path) && (
                          <span className="text-xs text-chatroom-text-muted truncate max-w-[50%]">
                            {getParentDir(path)}
                          </span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                <CommandGroup heading={recentFiles.length > 0 && !search ? 'ALL FILES' : undefined}>
                  {files.slice(0, 200).map((file) => (
                    <CommandItem
                      key={file.path}
                      value={file.path}
                      onSelect={() => handleSelect(file.path)}
                      // u05: Compact 28px height, u07: Full-width solid bg highlight (no left border)
                      className="flex flex-row items-center gap-2 rounded-none px-3 py-1 min-h-[28px] text-chatroom-text-primary hover:bg-chatroom-bg-hover data-[selected=true]:bg-chatroom-bg-hover"
                    >
                      <FileTypeIcon path={file.path} className="h-4 w-4 shrink-0 text-chatroom-text-muted" />
                      {/* u06: File name bold, directory lighter */}
                      <span className="text-sm font-medium truncate flex-1">
                        {getFileName(file.path)}
                      </span>
                      {/* u08: No file size in search list */}
                      {getParentDir(file.path) && (
                        <span className="text-xs text-chatroom-text-muted truncate max-w-[50%]">
                          {getParentDir(file.path)}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
                {files.length > 200 && (
                  <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted text-center">
                    SHOWING 200 OF {files.length} FILES
                  </div>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
});
