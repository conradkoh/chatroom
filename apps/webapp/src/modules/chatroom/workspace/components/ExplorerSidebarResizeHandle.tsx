'use client';

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';

import {
  EXPLORER_SIDEBAR_MAX_WIDTH_PX,
  EXPLORER_SIDEBAR_MIN_WIDTH_PX,
} from '../../hooks/persistence/useExplorerSidebarWidth';

interface ExplorerSidebarResizeHandleProps {
  widthPx: number;
  onWidthChange: (width: number) => void;
}

function clampWidth(width: number): number {
  return Math.min(EXPLORER_SIDEBAR_MAX_WIDTH_PX, Math.max(EXPLORER_SIDEBAR_MIN_WIDTH_PX, width));
}

export function ExplorerSidebarResizeHandle({
  widthPx,
  onWidthChange,
}: ExplorerSidebarResizeHandleProps) {
  const startXRef = useRef(0);
  const startWidthRef = useRef(widthPx);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      startXRef.current = event.clientX;
      startWidthRef.current = widthPx;
      event.currentTarget.setPointerCapture(event.pointerId);

      const onPointerMove = (moveEvent: globalThis.PointerEvent) => {
        const delta = moveEvent.clientX - startXRef.current;
        onWidthChange(clampWidth(startWidthRef.current + delta));
      };

      const onPointerUp = (upEvent: globalThis.PointerEvent) => {
        event.currentTarget.releasePointerCapture(upEvent.pointerId);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [widthPx, onWidthChange]
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={widthPx}
      onPointerDown={onPointerDown}
      className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize hover:bg-chatroom-border-strong/60 z-10"
    />
  );
}
