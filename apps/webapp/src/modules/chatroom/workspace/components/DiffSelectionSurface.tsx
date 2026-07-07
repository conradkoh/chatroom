'use client';

import { useRef, type ReactNode } from 'react';

import { useExplorerSelectionKeyboard } from '../hooks/useExplorerSelectionKeyboard';

interface DiffSelectionSurfaceProps {
  selectionSource: string;
  onSendSelectionToComposer?: (payload: { filePath: string; selectedText: string }) => void;
  className?: string;
  children: ReactNode;
}

/** Wraps diff content so Cmd+I can send the current text selection to the composer. */
export function DiffSelectionSurface({
  selectionSource,
  onSendSelectionToComposer,
  className,
  children,
}: DiffSelectionSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useExplorerSelectionKeyboard(containerRef, selectionSource, onSendSelectionToComposer);

  return (
    <div ref={containerRef} className={className}>
      {children}
    </div>
  );
}
