'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { FileTypeIcon } from './FileSelector/fileIcons';
import type { FileEntry } from './FileSelector/useFileSelector';

import { fuzzyMatch } from '@/lib/fuzzyMatch';

interface FileReferenceAutocompleteProps {
  /** All available workspace files */
  files: FileEntry[];
  /** The search query after the @ trigger */
  query: string;
  /** Position of the dropdown (relative to the textarea) */
  position: { top: number; left: number } | null;
  /** Called when a file is selected */
  onSelect: (filePath: string) => void;
  /** Called when the autocomplete should be dismissed */
  onDismiss: () => void;
  /** Whether the autocomplete is visible */
  visible: boolean;
}

/** Max items visible in the dropdown */
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
  files,
  query,
  position,
  onSelect,
  onDismiss,
  visible,
}: FileReferenceAutocompleteProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter and score files based on query
  const filteredFiles = (() => {
    if (!query) {
      // Show first N files when no query
      return files.slice(0, MAX_VISIBLE_ITEMS * 3);
    }

    const scored = files
      .map((file) => ({
        file,
        score: fuzzyMatch(query, file.path),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.map((item) => item.file);
  })();

  const displayFiles = filteredFiles.slice(0, MAX_VISIBLE_ITEMS * 3);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll('[data-autocomplete-item]');
    const selected = items[selectedIndex];
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!visible) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex((prev) => Math.min(prev + 1, displayFiles.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
        case 'Tab':
          if (displayFiles.length > 0 && selectedIndex < displayFiles.length) {
            e.preventDefault();
            e.stopPropagation();
            onSelect(displayFiles[selectedIndex]!.path);
          }
          break;
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          onDismiss();
          break;
      }
    },
    [visible, displayFiles, selectedIndex, onSelect, onDismiss]
  );

  // Attach keyboard listener
  useEffect(() => {
    if (!visible) return;
    // Use capture phase so we intercept before textarea's keydown handler
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [visible, handleKeyDown]);

  if (!visible || !position || displayFiles.length === 0) {
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
        {displayFiles.map((file, index) => (
          <div
            key={file.path}
            data-autocomplete-item
            onMouseDown={(e) => {
              // Use mouseDown instead of click to fire before blur
              e.preventDefault();
              onSelect(file.path);
            }}
            onMouseEnter={() => setSelectedIndex(index)}
            className={`flex items-center gap-2 px-3 py-1 min-h-[32px] cursor-pointer text-chatroom-text-primary ${
              index === selectedIndex ? 'bg-chatroom-bg-hover' : 'hover:bg-chatroom-bg-hover/50'
            }`}
          >
            <FileTypeIcon path={file.path} className="h-4 w-4 shrink-0 text-chatroom-text-muted" />
            <span className="text-sm font-medium truncate flex-1">{getFileName(file.path)}</span>
            {getParentDir(file.path) && (
              <span className="text-xs text-chatroom-text-muted truncate max-w-[50%]">
                {getParentDir(file.path)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});
