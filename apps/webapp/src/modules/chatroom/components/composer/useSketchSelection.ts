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
import {
  isSketchPalm,
  recordSketchPointerAndDropPalm,
  type SketchPenSession,
} from './sketchPointerPolicy';

export function useSketchSelection({
  canvasRef,
  activeLayerId = 'layer-1',
  selection = null,
  onSelectionChange = () => {},
  enabled,
  keyboardEnabled = enabled,
  disabled,
  penSession,
  onRequestDelete,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  activeLayerId?: SketchLayerId;
  selection?: SketchSelection | null;
  onSelectionChange?: (selection: SketchSelection | null) => void;
  enabled: boolean;
  keyboardEnabled?: boolean;
  disabled: boolean;
  penSession: SketchPenSession;
  onRequestDelete: (s: SketchSelectionRect) => void;
}) {
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const anchor = useRef<{ x: number; y: number } | null>(null);
  const draft = useRef<SketchSelectionRect | null>(null);
  const active = useRef<{ id: number; pointerType: string } | null>(null);
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
  const finish = useCallback(
    (pointerId: number, cancel: boolean) => {
      if (active.current?.id !== pointerId) return;
      const c = canvasRef.current;
      if (!c) return;
      endSelectionPointer(c, pointerId);
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
    [activeLayerId, canvasRef, clearSelection, onSelectionChange, paint]
  );
  const onPointerDown: ComponentProps<'canvas'>['onPointerDown'] = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      // A pen arriving during a touch marquee means that touch was a palm: restore and hand over.
      recordSketchPointerAndDropPalm(penSession, e.pointerType, active.current, (g) =>
        finish(g.id, true)
      );
      if (isSketchPalm(penSession, e.pointerType)) return;
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
      active.current = { id: e.pointerId, pointerType: e.pointerType };
      c.setPointerCapture(e.pointerId);
    },
    [canvasRef, disabled, enabled, finish, penSession, selection]
  );
  const onPointerMove: ComponentProps<'canvas'>['onPointerMove'] = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      recordSketchPointerAndDropPalm(penSession, e.pointerType, active.current, (g) =>
        finish(g.id, true)
      );
      if (active.current?.id !== e.pointerId) return;
      const c = canvasRef.current;
      const a = anchor.current;
      if (!c || !a) return;
      draft.current = mapPointerToSelectionDraft(c, a, e.clientX, e.clientY);
      if (!draft.current) return;
      paint(draft.current);
    },
    [canvasRef, finish, paint, penSession]
  );
  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => finish(e.pointerId, false),
    [finish]
  );
  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => finish(e.pointerId, true),
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
