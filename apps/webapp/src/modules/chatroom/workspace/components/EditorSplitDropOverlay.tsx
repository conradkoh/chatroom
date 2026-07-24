'use client';

import { type ReactNode, useCallback, useRef, useState } from 'react';

import { getWorkspaceTabDragKey, isWorkspaceTabDrag } from '../constants/workspaceTabDrag';

import { cn } from '@/lib/utils';

export type SplitDropSide = 'left' | 'right';

interface EditorSplitDropOverlayProps {
  children: ReactNode;
  onSplitDrop: (tabKey: string, side: SplitDropSide) => void;
}

export function EditorSplitDropOverlay({ children, onSplitDrop }: EditorSplitDropOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [hoverSide, setHoverSide] = useState<SplitDropSide | null>(null);

  const resolveSide = useCallback((clientX: number): SplitDropSide => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return 'right';
    const relativeX = clientX - rect.left;
    return relativeX < rect.width / 2 ? 'left' : 'right';
  }, []);

  const handleDragEnter = useCallback(
    (event: React.DragEvent) => {
      if (!isWorkspaceTabDrag(event.dataTransfer)) return;
      event.preventDefault();
      setDragActive(true);
      setHoverSide(resolveSide(event.clientX));
    },
    [resolveSide]
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent) => {
      if (!isWorkspaceTabDrag(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDragActive(true);
      setHoverSide(resolveSide(event.clientX));
    },
    [resolveSide]
  );

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    if (!containerRef.current?.contains(event.relatedTarget as Node)) {
      setDragActive(false);
      setHoverSide(null);
    }
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const tabKey = getWorkspaceTabDragKey(event.dataTransfer);
      const side = resolveSide(event.clientX);
      setDragActive(false);
      setHoverSide(null);
      if (tabKey) onSplitDrop(tabKey, side);
    },
    [onSplitDrop, resolveSide]
  );

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col flex-1 min-h-0 overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {dragActive && (
        <div
          data-testid="editor-split-drop-overlay"
          className="absolute inset-0 z-50 flex pointer-events-auto"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div
            data-testid="editor-split-drop-left"
            className={cn(
              'flex-1 flex items-center justify-center border-2 border-dashed transition-colors',
              hoverSide === 'left'
                ? 'bg-chatroom-accent/20 border-chatroom-accent'
                : 'bg-chatroom-bg-primary/60 border-transparent'
            )}
          >
            <span className="text-sm font-medium text-chatroom-text-primary">Split Left</span>
          </div>
          <div
            data-testid="editor-split-drop-right"
            className={cn(
              'flex-1 flex items-center justify-center border-2 border-dashed transition-colors',
              hoverSide === 'right'
                ? 'bg-chatroom-accent/20 border-chatroom-accent'
                : 'bg-chatroom-bg-primary/60 border-transparent'
            )}
          >
            <span className="text-sm font-medium text-chatroom-text-primary">Split Right</span>
          </div>
        </div>
      )}
    </div>
  );
}
