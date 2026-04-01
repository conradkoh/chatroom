'use client';

import { FileIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';

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

import { FilePreviewPanel } from './FilePreviewPanel';
import type { FileEntry } from './useFileSelector';

interface FileSelectorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: FileEntry[];
  selectedFile: string | null;
  onSelectFile: (filePath: string) => void;
  fileContent: {
    content: string;
    encoding: string;
    truncated: boolean;
    fetchedAt: number;
  } | null;
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
  selectedFile,
  onSelectFile,
  fileContent,
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>FILE SELECTOR</DialogTitle>
        <DialogDescription>Search and preview workspace files</DialogDescription>
      </DialogHeader>
      <DialogContent
        className="max-w-4xl rounded-none border-2 border-chatroom-border bg-chatroom-bg-primary p-0 shadow-none overflow-hidden"
      >
        <div className="flex h-[60vh] max-h-[500px]">
          {/* Left: file list */}
          <div className="w-1/2 border-r-2 border-chatroom-border flex flex-col">
            {/* Header */}
            <div className="border-b-2 border-chatroom-border px-3 py-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
                FILES
              </span>
            </div>

            <Command className="bg-chatroom-bg-primary text-chatroom-text-primary flex-1 flex flex-col">
              <CommandInput
                placeholder="Search files..."
                value={search}
                onValueChange={setSearch}
                className="text-chatroom-text-primary placeholder:text-chatroom-text-muted bg-transparent rounded-none"
              />
              <CommandList className="flex-1 overflow-auto">
                <CommandEmpty className="text-chatroom-text-muted text-xs font-bold uppercase tracking-wider px-4 py-6">
                  NO FILES FOUND
                </CommandEmpty>
                <CommandGroup>
                  {files.map((file) => (
                    <CommandItem
                      key={file.path}
                      value={file.path}
                      onSelect={() => onSelectFile(file.path)}
                      className={`flex flex-row items-center gap-2 rounded-none text-chatroom-text-primary hover:bg-chatroom-bg-hover data-[selected=true]:bg-chatroom-bg-hover ${
                        selectedFile === file.path
                          ? 'bg-chatroom-bg-hover border-l-2 border-l-chatroom-accent'
                          : ''
                      }`}
                    >
                      <FileIcon className="h-3.5 w-3.5 shrink-0 text-chatroom-text-muted" />
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-bold truncate font-mono">
                          {getFileName(file.path)}
                        </span>
                        {getParentDir(file.path) && (
                          <span className="text-[10px] text-chatroom-text-muted font-mono truncate">
                            {getParentDir(file.path)}
                          </span>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </div>

          {/* Right: file preview */}
          <div className="w-1/2 bg-chatroom-bg-primary">
            <FilePreviewPanel
              filePath={selectedFile}
              content={fileContent}
              isLoading={!!selectedFile && !fileContent}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});
