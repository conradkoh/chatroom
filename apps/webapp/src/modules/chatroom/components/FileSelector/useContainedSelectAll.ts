'use client';

import { useCallback, useEffect, type RefObject } from 'react';

function selectAllInContainer(container: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(container);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function useContainedSelectAll(containerRef: RefObject<HTMLElement | null>): void {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'a') return;

      const container = containerRef.current;
      if (!container) return;

      const selection = window.getSelection();
      const anchorNode = selection?.anchorNode ?? null;
      const activeElement = document.activeElement;

      const isInside =
        container.contains(anchorNode) ||
        (activeElement instanceof Node && container.contains(activeElement));

      if (!isInside) return;

      event.preventDefault();
      event.stopPropagation();
      selectAllInContainer(container);
    },
    [containerRef]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [handleKeyDown]);
}
