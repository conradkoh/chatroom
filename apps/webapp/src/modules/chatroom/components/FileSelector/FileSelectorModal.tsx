'use client';

import { FileIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

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
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="File Selector"
      description="Search and preview workspace files"
      className="max-w-4xl"
    >
      <div className="flex h-[60vh] max-h-[500px]">
        {/* Left: file list */}
        <div className="w-1/2 border-r border-border flex flex-col">
          <CommandInput
            placeholder="Search files..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="flex-1 overflow-auto">
            <CommandEmpty>No files found.</CommandEmpty>
            <CommandGroup>
              {files.map((file) => (
                <CommandItem
                  key={file.path}
                  value={file.path}
                  onSelect={() => onSelectFile(file.path)}
                  className={
                    selectedFile === file.path
                      ? 'bg-accent text-accent-foreground'
                      : ''
                  }
                >
                  <FileIcon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm truncate">{getFileName(file.path)}</span>
                    {getParentDir(file.path) && (
                      <span className="text-xs text-muted-foreground truncate">
                        {getParentDir(file.path)}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </div>

        {/* Right: file preview */}
        <div className="w-1/2 bg-card">
          <FilePreviewPanel
            filePath={selectedFile}
            content={fileContent}
            isLoading={!!selectedFile && !fileContent}
          />
        </div>
      </div>
    </CommandDialog>
  );
});
