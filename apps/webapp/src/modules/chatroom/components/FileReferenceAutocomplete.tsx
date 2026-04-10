'use client';

import { memo, useEffect, useRef } from 'react';

import { FileTypeIcon } from './FileSelector/fileIcons';
import type { FileEntry } from './FileSelector/useFileSelector';

interface FileReferenceAutocompleteProps {
  /** Pre-filtered results from the trigger system */
  results: FileEntry[];
  /** Currently highlighted item index */
  selectedIndex: number;
  /** Position of the dropdown (relative to the textarea) */
  position: { top: number; left: number } | null;
  /** Called when a file is selected (via mouse click) */
  onSelect: (filePath: string) => void;
  /** Called when mouse hovers over an item */
  onHoverItem: (index: number) => void;
  /** Whether the autocomplete is visible */
  visible: boolean;
}

/** Max items visible in the dropdown (for scroll height calculation) */
const MAX_VISIBLE_ITEMS = 8;

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

export const FileReferenceAutocomplete = memo(function FileReferenceAutocomplete({
  results,
  selectedIndex,
  position,
  onSelect,
  onHoverItem,
  visible,
}: FileReferenceAutocompleteProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll('[data-autocomplete-item]');
    const selected = items[selectedIndex];
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!visible || !position || results.length === 0) {
    return null;
  }

  return (
    <div
      className="absolute z-50 w-[400px] max-w-[90vw] border-2 border-chatroom-border bg-chatroom-bg-primary shadow-lg overflow-hidden"
      style={{
        bottom: position.top,
        left: position.left,
      }}
    >
      <div
        ref={listRef}
        className="overflow-y-auto"
        style={{ maxHeight: `${MAX_VISIBLE_ITEMS * 32}px` }}
      >
        {results.map((file, index) => {
          const parentDir = getParentDir(file.path);
          return (
            <div
              key={file.path}
              data-autocomplete-item
              onMouseDown={(e) => {
                // Use mouseDown instead of click to fire before blur
                e.preventDefault();
                onSelect(file.path);
              }}
              onMouseEnter={() => onHoverItem(index)}
              className={`flex items-center gap-2 px-3 py-1 min-h-[32px] cursor-pointer text-chatroom-text-primary ${
                index === selectedIndex ? 'bg-chatroom-bg-hover' : 'hover:bg-chatroom-bg-hover/50'
              }`}
            >
              <FileTypeIcon
                path={file.path}
                className="h-4 w-4 shrink-0 text-chatroom-text-muted"
              />
              <span className="text-sm font-medium truncate flex-1">{getFileName(file.path)}</span>
              {parentDir && (
                <span className="text-xs text-chatroom-text-muted truncate max-w-[50%]">
                  {parentDir}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
