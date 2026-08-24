'use client';
// fallow-ignore-file complexity
import {
  useCallback,
  useEffect,
  useRef,
  type ComponentProps,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

import { mapClientPointToCanvas } from './sketchCanvasDrawing';
import { drawSketchTransformOverlay } from './sketchCanvasSelection';
import type { SketchSelection, SketchFloatingSelectionMeta } from './sketchDocument';
import { translateTransform } from './sketchTransform';

export function useSketchManipulation({
  canvasRef,
  overlayRef,
  activeTool,
  disabled,
  selection,
  floating,
  beginFloatingSelection,
  updateFloatingTransform,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
  activeTool: 'move' | 'transform';
  disabled: boolean;
  selection: SketchSelection | null;
  floating: SketchFloatingSelectionMeta | null;
  beginFloatingSelection: () => boolean;
  updateFloatingTransform: (t: SketchFloatingSelectionMeta['transform']) => void;
}) {
  const active = useRef<{
    id: number;
    start: { x: number; y: number };
    transform: SketchFloatingSelectionMeta['transform'];
  } | null>(null);
  const paint = useCallback(() => {
    const ctx = overlayRef.current?.getContext('2d');
    if (ctx && floating)
      drawSketchTransformOverlay(
        ctx,
        floating.transform,
        floating.sourceWidth,
        floating.sourceHeight,
        activeTool
      );
  }, [activeTool, overlayRef, floating]);
  useEffect(() => {
    paint();
  }, [paint]);
  const down: ComponentProps<'canvas'>['onPointerDown'] = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (disabled || !e.isPrimary || e.button !== 0) return;
      if (!floating && !selection) return;
      if (!floating && !beginFloatingSelection()) return;
      const c = canvasRef.current;
      const p = c && mapClientPointToCanvas(e.clientX, e.clientY, c);
      if (!c || !p) return;
      const f = floating;
      if (!f) return;
      active.current = { id: e.pointerId, start: p, transform: f.transform };
      c.setPointerCapture(e.pointerId);
    },
    [beginFloatingSelection, canvasRef, disabled, floating, selection]
  );
  const move: ComponentProps<'canvas'>['onPointerMove'] = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const a = active.current;
      const c = canvasRef.current;
      if (!a || a.id !== e.pointerId || !c) return;
      const p = mapClientPointToCanvas(e.clientX, e.clientY, c);
      if (!p) return;
      updateFloatingTransform(translateTransform(a.transform, p.x - a.start.x, p.y - a.start.y));
    },
    [canvasRef, updateFloatingTransform]
  );
  const finish: ComponentProps<'canvas'>['onPointerUp'] = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const c = canvasRef.current;
      if (active.current?.id !== e.pointerId || !c) return;
      if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
      active.current = null;
    },
    [canvasRef]
  );
  return {
    manipulationBindings: {
      onPointerDown: down,
      onPointerMove: move,
      onPointerUp: finish,
      onPointerCancel: finish,
      onLostPointerCapture: finish,
    },
  };
}
