'use client';
// fallow-ignore-file complexity
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
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
import type { SketchLayerId, SketchSelection } from './sketchDocument';

export function useSketchSelection({
  canvasRef,
  activeLayerId = 'layer-1',
  selection = null,
  onSelectionChange = () => {},
  enabled,
  keyboardEnabled = enabled,
  disabled,
  onRequestDelete,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  activeLayerId?: SketchLayerId;
  selection?: SketchSelection | null;
  onSelectionChange?: (selection: SketchSelection | null) => void;
  enabled: boolean;
  keyboardEnabled?: boolean;
  disabled: boolean;
  onRequestDelete: (s: SketchSelectionRect) => void;
}) {
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const anchor = useRef<{ x: number; y: number } | null>(null);
  const draft = useRef<SketchSelectionRect | null>(null);
  const active = useRef<number | null>(null);
  const priorSelection = useRef<SketchSelection | null>(null);
  const paint = useCallback((s: SketchSelectionRect | null) => {
    const c = overlayRef.current?.getContext('2d');
    if (c) drawSketchSelectionMarquee(c, s);
  }, []);
  const clearSelection = useCallback(() => {
    onSelectionChange(null);
    anchor.current = null;
    draft.current = null;
    paint(null);
  }, [onSelectionChange, paint]);
  useLayoutEffect(() => paint(selection?.rect ?? null), [paint, selection]);
  const selectAll = useCallback(() => {
    onSelectionChange({ layerId: activeLayerId, rect: FULL_SKETCH_SELECTION });
    paint(FULL_SKETCH_SELECTION);
  }, [activeLayerId, onSelectionChange, paint]);
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
      const result = resolveSelectionFinish(
        cancel,
        c,
        draft.current,
        priorSelection.current?.rect ?? null
      );
      if (result.type === 'commit')
        onSelectionChange({ layerId: activeLayerId, rect: result.selection });
      else if (result.type === 'restore') {
        onSelectionChange(priorSelection.current);
        paint(result.selection);
      } else clearSelection();
      active.current = null;
      anchor.current = null;
      draft.current = null;
    },
    [activeLayerId, canvasRef, clearSelection, onSelectionChange]
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
    if (!keyboardEnabled || disabled) return;
    const listener = (e: KeyboardEvent) => {
      const a = resolveSketchSelectionAction(e, selection?.rect != null);
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
        onRequestDelete(selection.rect);
      }
    };
    document.addEventListener('keydown', listener, true);
    return () => document.removeEventListener('keydown', listener, true);
  }, [clearSelection, disabled, keyboardEnabled, onRequestDelete, selectAll, selection]);
  return {
    overlayRef,
    selection: selection?.rect ?? null,
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
