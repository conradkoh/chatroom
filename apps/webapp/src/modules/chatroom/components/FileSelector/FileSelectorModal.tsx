'use client';

import { Loader2 } from 'lucide-react';
import { memo, useCallback, useState } from 'react';

import { getFileIcon } from './fileIcons';

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

/** Format file size for display. */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const FileSelectorModal = memo(function FileSelectorModal({
  open,
  onOpenChange,
  files,
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
      <DialogContent
        className="max-w-lg rounded-none border-2 border-chatroom-border bg-chatroom-bg-primary p-0 shadow-none overflow-hidden"
      >
        <Command className="bg-chatroom-bg-primary text-chatroom-text-primary">
          <CommandInput
            placeholder="Search files..."
            value={search}
            onValueChange={setSearch}
            className="text-chatroom-text-primary placeholder:text-chatroom-text-muted bg-transparent rounded-none"
          />
          <CommandList className="max-h-[300px]">
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
              {files.slice(0, 200).map((file) => (
                <CommandItem
                  key={file.path}
                  value={file.path}
                  onSelect={() => handleSelect(file.path)}
                  className="flex flex-row items-center gap-2 rounded-none text-chatroom-text-primary hover:bg-chatroom-bg-hover data-[selected=true]:bg-chatroom-bg-hover data-[selected=true]:border-l-2 data-[selected=true]:border-l-chatroom-accent"
                >
                {(() => {
                    const Icon = getFileIcon(file.path);
                    return <Icon className="h-3.5 w-3.5 shrink-0 text-chatroom-text-muted" />;
                  })()}
                  <span className="text-xs font-bold truncate font-mono flex-1">
                    {getFileName(file.path)}
                  </span>
                  {getParentDir(file.path) && (
                    <span className="text-[10px] text-chatroom-text-muted font-mono truncate max-w-[50%]">
                      {getParentDir(file.path)}
                    </span>
                  )}
                  {file.size != null && (
                    <span className="text-[10px] text-chatroom-text-muted font-mono shrink-0 tabular-nums">
                      {formatFileSize(file.size)}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            {files.length > 200 && (
              <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted text-center">
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
