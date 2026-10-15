'use client';
// fallow-ignore-file complexity
// fallow-ignore-file unused-export
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

import { mapClientPointToCanvas, getCssToCanvasScale } from './sketchCanvasDrawing';
import { drawSketchTransformOverlay } from './sketchCanvasSelection';
import type { SketchSelection, SketchFloatingSelectionMeta } from './sketchDocument';
import type { SketchToolId } from './sketchTools';
import {
  clampTransformToCanvas,
  hitTestTransformHandle,
  resolveSketchScaleAspectMode,
  rotateTransformFromHandle,
  scaleTransformFromHandle,
  translateTransform,
  type SketchTransformHandle,
} from './sketchTransform';

/**
 * Maps a transform hit-test handle (and whether a drag is in progress) to a CSS cursor.
 * `null` means the pointer is not over the transformed box.
 */
export function cursorForSketchManipulation(
  handle: SketchTransformHandle | null,
  dragging: boolean
): string {
  if (handle === null) return 'default';
  switch (handle) {
    case 'north-west':
    case 'south-east':
      return 'nwse-resize';
    case 'north-east':
    case 'south-west':
      return 'nesw-resize';
    case 'north':
    case 'south':
      return 'ns-resize';
    case 'east':
    case 'west':
      return 'ew-resize';
    case 'move':
      return 'move';
    case 'rotate':
      return dragging ? 'grabbing' : 'grab';
  }
}

// An identity scale anchored at a selection rect, matching beginFloatingSelection so hover hit
// tests agree with what a pointerdown would do before the floating handles are drawn.
const IDENTITY_SCALE = { scaleX: 1, scaleY: 1, rotationRadians: 0 } as const;

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
  activeTool: SketchToolId;
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
  const [hoverHandle, setHoverHandle] = useState<SketchTransformHandle | null>(null);
  // Mirrors the active drag handle in state (not a ref) so the cursor re-renders during a drag.
  const [dragHandle, setDragHandle] = useState<SketchTransformHandle | null>(null);
  // Only the transform tool draws and hit-tests the 8 handles; every other tool behaves as 'move'.
  const mode: 'move' | 'transform' = activeTool === 'transform' ? 'transform' : 'move';
  const paint = useCallback(() => {
    const canvas = overlayRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    if (!floating) {
      // A committed selection leaves no overlay to draw, so clear the handles rather than
      // leaving the previous frame's transform handles stranded on the overlay canvas.
      // Guarded because lightweight canvas stubs (jsdom) do not implement clearRect.
      if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    drawSketchTransformOverlay(
      ctx,
      floating.transform,
      floating.sourceWidth,
      floating.sourceHeight,
      mode
    );
  }, [mode, overlayRef, floating]);
  useEffect(() => {
    paint();
  }, [paint]);
  // Drop stale hover feedback whenever the tool or availability changes.
  useEffect(() => {
    setHoverHandle(null);
  }, [activeTool, disabled]);
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
      setDragHandle(handle);
      c.setPointerCapture(e.pointerId);
    },
    [activeTool, beginFloatingSelection, canvasRef, disabled, floating, selection]
  );
  const move: ComponentProps<'canvas'>['onPointerMove'] = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const c = canvasRef.current;
      const p = c && mapClientPointToCanvas(e.clientX, e.clientY, c);
      if (!c || !p) return;
      const a = active.current;
      if (!a) {
        // Hover feedback: preview the cursor a click here would produce. Skipped while a drag is
        // active so the captured handle's cursor wins regardless of pointer position.
        if (disabled) return;
        if (activeTool === 'transform') {
          const source = floating
            ? { t: floating.transform, w: floating.sourceWidth, h: floating.sourceHeight }
            : selection
              ? {
                  t: { x: selection.rect.x, y: selection.rect.y, ...IDENTITY_SCALE },
                  w: selection.rect.width,
                  h: selection.rect.height,
                }
              : null;
          // React bails out when the new value is identical (Object.is), so moving within the
          // same handle does not trigger a re-render.
          setHoverHandle(
            source
              ? hitTestTransformHandle(p, source.t, source.w, source.h, getCssToCanvasScale(c))
              : null
          );
        } else if (activeTool === 'move') {
          setHoverHandle(floating || selection ? 'move' : null);
        } else {
          setHoverHandle(null);
        }
        return;
      }
      if (a.id !== e.pointerId) return;
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
          resolveSketchScaleAspectMode(e) === 'proportional'
        );
      else next = translateTransform(a.transform, p.x - a.start.x, p.y - a.start.y);
      updateFloatingTransform(clampTransformToCanvas(next, f.sourceWidth, f.sourceHeight));
    },
    [activeTool, canvasRef, disabled, floating, selection, updateFloatingTransform]
  );
  const endDrag = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>, cancel: boolean) => {
      const c = canvasRef.current;
      if (active.current?.id !== e.pointerId || !c) return;
      if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
      if (cancel && active.current && floating) updateFloatingTransform(active.current.transform);
      active.current = null;
      setDragHandle(null);
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
  const onPointerLeave = useCallback(() => setHoverHandle(null), []);
  const isManipulationTool = activeTool === 'move' || activeTool === 'transform';
  // Only manipulation tools drive the cursor; every other tool keeps the panel's own classes.
  const cursor =
    disabled || !isManipulationTool
      ? undefined
      : cursorForSketchManipulation(dragHandle ?? hoverHandle, dragHandle === 'rotate');
  return {
    manipulationBindings: {
      onPointerDown: down,
      onPointerMove: move,
      onPointerUp: finish,
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
      onPointerLeave,
    },
    cursor,
  };
}
