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

import { mapClientPointToCanvas, getCssToCanvasScale } from './sketchCanvasDrawing';
import { drawSketchTransformOverlay } from './sketchCanvasSelection';
import type { SketchSelection, SketchFloatingSelectionMeta } from './sketchDocument';
import {
  clampTransformToCanvas,
  hitTestTransformHandle,
  rotateTransformFromHandle,
  scaleTransformFromHandle,
  translateTransform,
  type SketchTransformHandle,
} from './sketchTransform';

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
  beginFloatingSelection: () => SketchFloatingSelectionMeta | null;
  updateFloatingTransform: (t: SketchFloatingSelectionMeta['transform']) => void;
}) {
  const active = useRef<{
    id: number;
    start: { x: number; y: number };
    transform: SketchFloatingSelectionMeta['transform'];
    handle: SketchTransformHandle;
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
      const started = floating ?? beginFloatingSelection();
      if (!started) return;
      const c = canvasRef.current;
      const p = c && mapClientPointToCanvas(e.clientX, e.clientY, c);
      if (!c || !p) return;
      const handle =
        activeTool === 'transform'
          ? hitTestTransformHandle(
              p,
              started.transform,
              started.sourceWidth,
              started.sourceHeight,
              getCssToCanvasScale(c)
            )
          : 'move';
      if (!handle) return;
      active.current = { id: e.pointerId, start: p, transform: started.transform, handle };
      c.setPointerCapture(e.pointerId);
    },
    [activeTool, beginFloatingSelection, canvasRef, disabled, floating, selection]
  );
  const move: ComponentProps<'canvas'>['onPointerMove'] = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const a = active.current;
      const c = canvasRef.current;
      if (!a || a.id !== e.pointerId || !c) return;
      const p = mapClientPointToCanvas(e.clientX, e.clientY, c);
      if (!p) return;
      const f = floating;
      if (!f) return;
      let next = a.transform;
      if (a.handle === 'rotate')
        next = rotateTransformFromHandle(a.transform, p, a.start, f.sourceWidth, f.sourceHeight);
      else if (a.handle !== 'move')
        next = scaleTransformFromHandle(
          a.transform,
          a.handle,
          p,
          a.start,
          f.sourceWidth,
          f.sourceHeight,
          !['north', 'south', 'east', 'west'].includes(a.handle)
        );
      else next = translateTransform(a.transform, p.x - a.start.x, p.y - a.start.y);
      updateFloatingTransform(clampTransformToCanvas(next, f.sourceWidth, f.sourceHeight));
    },
    [canvasRef, floating, updateFloatingTransform]
  );
  const endDrag = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>, cancel: boolean) => {
      const c = canvasRef.current;
      if (active.current?.id !== e.pointerId || !c) return;
      if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
      if (cancel && active.current && floating) updateFloatingTransform(active.current.transform);
      active.current = null;
    },
    [canvasRef, floating, updateFloatingTransform]
  );
  const finish: ComponentProps<'canvas'>['onPointerUp'] = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => endDrag(e, false),
    [endDrag]
  );
  const cancel: ComponentProps<'canvas'>['onPointerCancel'] = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => endDrag(e, true),
    [endDrag]
  );
  return {
    manipulationBindings: {
      onPointerDown: down,
      onPointerMove: move,
      onPointerUp: finish,
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
    },
  };
}
