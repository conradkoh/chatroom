'use client';

import { memo, useEffect, useMemo, useRef } from 'react';

import { FileTypeIcon } from './FileSelector/fileIcons';
import type { FileEntry } from './FileSelector/useFileSelector';

import { getFileName, getParentDir } from '@/lib/pathUtils';
import { decodeWorkspaceId, getWorkspaceDisplayName } from '@/lib/workspaceIdentifier';

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
/** Dropdown width in pixels */
const DROPDOWN_WIDTH = 400;

/**
 * Resolve workspace display names for a set of results.
 * Returns a Map from workspaceId → display name.
 * Returns an empty map if all results share the same workspace (no disambiguation needed).
 */
function resolveWorkspaceLabels(results: FileEntry[]): Map<string, string> {
  const ids = new Set<string>();
  for (const f of results) {
    if (f.workspaceId) ids.add(f.workspaceId);
  }
  // Only show labels when multiple workspaces are present
  if (ids.size <= 1) return new Map();

  const labels = new Map<string, string>();
  for (const id of ids) {
    try {
      const decoded = decodeWorkspaceId(id);
      labels.set(id, getWorkspaceDisplayName(decoded.workingDir));
    } catch {
      labels.set(id, '?');
    }
  }
  return labels;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const lastMousePosRef = useRef<{ x: number; y: number } | null>(null);

  // Resolve workspace labels only when multiple workspaces are present
  const workspaceLabels = useMemo(() => resolveWorkspaceLabels(results), [results]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll('[data-autocomplete-item]');
    const selected = items[selectedIndex];
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Clamp the left position so the dropdown doesn't overflow the parent
  useEffect(() => {
    if (!containerRef.current || !visible || !position) return;
    const parent = containerRef.current.parentElement;
    if (!parent) return;
    const parentWidth = parent.offsetWidth;
    const maxLeft = Math.max(0, parentWidth - DROPDOWN_WIDTH);
    const clampedLeft = Math.min(position.left, maxLeft);
    containerRef.current.style.left = `${clampedLeft}px`;
  }, [visible, position]);

  if (!visible || !position || results.length === 0) {
    return null;
  }

  return (
    <div
      ref={containerRef}
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
          const wsLabel = file.workspaceId ? workspaceLabels.get(file.workspaceId) : undefined;
          return (
            <div
              key={file.workspaceId ? `${file.workspaceId}:${file.path}` : file.path}
              data-autocomplete-item
              onMouseDown={(e) => {
                // Use mouseDown instead of click to fire before blur
                e.preventDefault();
                onSelect(file.path);
              }}
              onMouseMove={(e) => {
                const last = lastMousePosRef.current;
                if (last && last.x === e.clientX && last.y === e.clientY) return;
                lastMousePosRef.current = { x: e.clientX, y: e.clientY };
                onHoverItem(index);
              }}
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
                <span className="text-xs text-chatroom-text-muted truncate max-w-[40%]">
                  {parentDir}
                </span>
              )}
              {wsLabel && (
                <span className="text-[10px] text-chatroom-accent/70 font-medium shrink-0 ml-1">
                  {wsLabel}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
