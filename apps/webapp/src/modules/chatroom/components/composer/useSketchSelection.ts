'use client';
// fallow-ignore-file complexity
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

import { mapClientPointToCanvas } from './sketchCanvasDrawing';
import {
  drawSketchSelectionMarquee,
  FULL_SKETCH_SELECTION,
  resolveSketchSelectionAction,
  type SketchSelectionRect,
} from './sketchCanvasSelection';
import {
  endSelectionPointer,
  mapPointerToSelectionDraft,
  resolveSelectionFinish,
  shouldStartSketchSelection,
} from './sketchCanvasSelectionPointer';

export function useSketchSelection({
  canvasRef,
  enabled,
  disabled,
  onRequestDelete,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  enabled: boolean;
  disabled: boolean;
  onRequestDelete: (s: SketchSelectionRect) => void;
}) {
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [selection, setSelection] = useState<SketchSelectionRect | null>(null);
  const anchor = useRef<{ x: number; y: number } | null>(null);
  const draft = useRef<SketchSelectionRect | null>(null);
  const active = useRef<number | null>(null);
  const priorSelection = useRef<SketchSelectionRect | null>(null);
  const paint = useCallback((s: SketchSelectionRect | null) => {
    const c = overlayRef.current?.getContext('2d');
    if (c) drawSketchSelectionMarquee(c, s);
  }, []);
  const clearSelection = useCallback(() => {
    setSelection(null);
    anchor.current = null;
    draft.current = null;
    paint(null);
  }, [paint]);
  useLayoutEffect(() => paint(selection), [paint, selection]);
  const selectAll = useCallback(() => {
    setSelection(FULL_SKETCH_SELECTION);
    paint(FULL_SKETCH_SELECTION);
  }, [paint]);
  useEffect(() => {
    if (!enabled) clearSelection();
  }, [enabled, clearSelection]);
  const onPointerDown: ComponentProps<'canvas'>['onPointerDown'] = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (
        !shouldStartSketchSelection(
          disabled,
          enabled,
          e.isPrimary,
          e.button,
          active.current !== null
        )
      )
        return;
      const c = canvasRef.current;
      const p = c && mapClientPointToCanvas(e.clientX, e.clientY, c);
      if (!c || !p) return;
      anchor.current = p;
      priorSelection.current = selection;
      active.current = e.pointerId;
      c.setPointerCapture(e.pointerId);
    },
    [canvasRef, disabled, enabled, selection]
  );
  const onPointerMove: ComponentProps<'canvas'>['onPointerMove'] = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (active.current !== e.pointerId) return;
      const c = canvasRef.current;
      const a = anchor.current;
      if (!c || !a) return;
      draft.current = mapPointerToSelectionDraft(c, a, e.clientX, e.clientY);
      if (!draft.current) return;
      paint(draft.current);
    },
    [canvasRef, paint]
  );
  const finish = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>, cancel: boolean) => {
      if (active.current !== e.pointerId) return;
      const c = canvasRef.current;
      if (!c) return;
      endSelectionPointer(c, e.pointerId);
      const result = resolveSelectionFinish(cancel, c, draft.current, priorSelection.current);
      if (result.type === 'commit') setSelection(result.selection);
      else if (result.type === 'restore') {
        setSelection(result.selection);
        paint(result.selection);
      } else clearSelection();
      active.current = null;
      anchor.current = null;
      draft.current = null;
    },
    [canvasRef, clearSelection]
  );
  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => finish(e, false),
    [finish]
  );
  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => finish(e, true),
    [finish]
  );
  useEffect(() => {
    if (!enabled || disabled) return;
    const listener = (e: KeyboardEvent) => {
      const a = resolveSketchSelectionAction(e, selection !== null);
      if (a === 'select-all') {
        e.preventDefault();
        e.stopPropagation();
        selectAll();
      } else if (a === 'clear') {
        e.preventDefault();
        e.stopPropagation();
        clearSelection();
      } else if (a === 'request-delete' && selection) {
        e.preventDefault();
        onRequestDelete(selection);
      }
    };
    document.addEventListener('keydown', listener, true);
    return () => document.removeEventListener('keydown', listener, true);
  }, [clearSelection, disabled, enabled, onRequestDelete, selectAll, selection]);
  return {
    overlayRef,
    selection,
    selectionBindings: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture: onPointerCancel,
    },
    selectAll,
    clearSelection,
  };
}
