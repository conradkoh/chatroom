'use client';

import { useEffect } from 'react';

import { resolveSketchToolShortcut, type SketchToolId } from './sketchTools';

export function useSketchToolShortcuts({
  enabledTools,
  onToolChange,
}: {
  enabledTools: readonly SketchToolId[];
  onToolChange: (tool: SketchToolId) => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const tool = resolveSketchToolShortcut(event, enabledTools);
      if (!tool) return;
      event.preventDefault();
      onToolChange(tool);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabledTools, onToolChange]);
}
