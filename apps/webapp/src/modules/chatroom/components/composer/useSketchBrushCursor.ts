'use client';

import {
  useCallback,
  useEffect,
  type ComponentProps,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

import {
  drawSketchBrushCursor,
  supportsSketchBrushCursor,
  type SketchBrushCursorVariant,
} from './sketchCanvasBrushCursor';
import { getCssToCanvasScale, mapClientPointToCanvas } from './sketchCanvasDrawing';

export function useSketchBrushCursor({
  canvasRef,
  overlayRef,
  enabled,
  brushSize,
  variant,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
  enabled: boolean;
  brushSize: number;
  variant: SketchBrushCursorVariant;
}) {
  const clear = useCallback(() => {
    const ctx = overlayRef.current?.getContext('2d');
    if (ctx) drawSketchBrushCursor(ctx, null, brushSize, 1, variant);
  }, [brushSize, overlayRef, variant]);
  const paint = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      const overlay = overlayRef.current;
      const ctx = overlay?.getContext('2d');
      if (!canvas || !overlay || !ctx) return;
      const point = mapClientPointToCanvas(clientX, clientY, canvas);
      drawSketchBrushCursor(ctx, point, brushSize, getCssToCanvasScale(canvas), variant);
    },
    [brushSize, canvasRef, overlayRef, variant]
  );
  useEffect(() => {
    if (!enabled) clear();
  }, [clear, enabled]);
  const onPointerMove: ComponentProps<'canvas'>['onPointerMove'] = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (enabled && supportsSketchBrushCursor()) paint(event.clientX, event.clientY);
    },
    [enabled, paint]
  );
  const onPointerLeave: ComponentProps<'canvas'>['onPointerLeave'] = useCallback(
    () => clear(),
    [clear]
  );
  return {
    brushCursorBindings: { onPointerMove, onPointerLeave },
    showBrushCursor: enabled && supportsSketchBrushCursor(),
  };
}
