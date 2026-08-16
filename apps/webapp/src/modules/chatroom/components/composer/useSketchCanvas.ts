'use client';
import { useCallback, useRef, useState, type RefObject } from 'react';

import {
  captureBackingSnapshot,
  imageDataPixelsEqual,
  sketchCanvasHasInk,
  type SketchHistorySnapshot,
} from './sketchCanvasSnapshot';
import {
  SKETCH_CANVAS_COLORS,
  SKETCH_ERASER_WIDTH_CSS_PX,
  SKETCH_MIN_STROKE_DISTANCE_CSS_PX,
  SKETCH_PEN_WIDTH_CSS_PX,
  SKETCH_BRUSH_PALETTE,
  SKETCH_ZOOM_DEFAULT,
  SKETCH_ZOOM_MAX,
  SKETCH_ZOOM_MIN,
} from './sketchConstants';
import { buildSketchFileName } from './sketchFileName';
import type { ResizeHandle, SketchFloatingSelection, SketchRect } from './sketchSelectionTypes';
import { useSketchHistory } from './useSketchHistory';
import { useSketchSelection } from './useSketchSelection';

export type SketchTool = 'pen' | 'eraser' | 'select';
export type UseSketchCanvasResult = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  tool: SketchTool;
  setTool: (tool: SketchTool) => void;
  hasContent: boolean;
  clear: () => void;
  exportPngFile: () => Promise<File | null>;
  bindCanvas: (canvas: HTMLCanvasElement) => () => void;
  brushColor: string;
  setBrushColor: (color: string) => void;
  zoom: number;
  setZoom: (value: number) => void;
  selectionMarquee: SketchRect | null;
  floatingSelection: SketchFloatingSelection | null;
  onResizeHandlePointerDown: (handle: ResizeHandle, e: React.PointerEvent) => void;
  deleteSelection: () => void;
  copySelection: () => Promise<void>;
  pasteFromClipboard: () => Promise<void>;
  commitSelection: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
};
export function useSketchCanvas(): UseSketchCanvasResult {
  const history = useSketchHistory();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const [tool, setToolState] = useState<SketchTool>('pen');
  const [hasContent, setHasContent] = useState(false);
  const hasContentRef = useRef(false);
  const updateHasContent = useCallback((value: boolean) => {
    hasContentRef.current = value;
    setHasContent(value);
  }, []);
  const toolRef = useRef(tool);
  const [brushColor, setBrushColorState] = useState<string>(SKETCH_BRUSH_PALETTE[0]);
  const brushColorRef = useRef<string>(brushColor);
  const setBrushColor = useCallback((color: string) => {
    brushColorRef.current = color;
    setBrushColorState(color);
  }, []);
  const [zoom, setZoomState] = useState(SKETCH_ZOOM_DEFAULT);
  const zoomRef = useRef(zoom);
  const historyRef = useRef(history);
  historyRef.current = history;
  const isApplyingHistoryRef = useRef(false);
  const selectionApiRef = useRef<{
    captureCompositedSnapshot?: () => SketchHistorySnapshot | null;
  } | null>(null);
  const captureSnapshot = useCallback(() => {
    const ctx = ctxRef.current;
    return ctx ? captureBackingSnapshot(ctx, hasContentRef.current) : null;
  }, []);
  const recordMutation = useCallback((snapshot: SketchHistorySnapshot) => {
    if (!isApplyingHistoryRef.current) historyRef.current.pushSnapshot(snapshot);
  }, []);
  const selection = useSketchSelection({
    getCtx: () => ctxRef.current,
    getCanvas: () => canvasRef.current,
    getDpr: () => window.devicePixelRatio || 1,
    updateHasContent,
    getHasContent: () => hasContentRef.current,
    onBeforeLift: () => {
      const snapshot = captureSnapshot();
      if (snapshot) recordMutation(snapshot);
    },
    onBeforeSelectionWrite: () => {
      const snapshot = selectionApiRef.current?.captureCompositedSnapshot?.();
      if (snapshot) recordMutation(snapshot);
    },
    isHistoryRecording: () => !isApplyingHistoryRef.current,
  });
  selectionApiRef.current = selection;
  const applyHistory = useCallback(
    (snapshot: SketchHistorySnapshot) => {
      const ctx = ctxRef.current;
      if (ctx) {
        isApplyingHistoryRef.current = true;
        try {
          selection.clearSelectionWithoutHistory();
          ctx.putImageData(snapshot.imageData, 0, 0);
          updateHasContent(snapshot.hasContent);
        } finally {
          isApplyingHistoryRef.current = false;
        }
      }
    },
    [selection, updateHasContent]
  );
  const undoHistory = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const current = captureBackingSnapshot(ctx, hasContentRef.current);
    const previous = historyRef.current.undo(current);
    if (previous) applyHistory(previous);
  }, [applyHistory]);
  const redoHistory = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const current = captureBackingSnapshot(ctx, hasContentRef.current);
    const next = historyRef.current.redo(current);
    if (next) applyHistory(next);
  }, [applyHistory]);
  const setTool = useCallback(
    (next: SketchTool) => {
      if (toolRef.current === 'select' && next !== 'select')
        selection.commitSelection({ recordHistory: false });
      setToolState(next);
    },
    [selection]
  );
  const setZoom = useCallback(
    (value: number) => {
      selection.commitSelection({ recordHistory: false });
      const next = Number.isFinite(value)
        ? Math.min(SKETCH_ZOOM_MAX, Math.max(SKETCH_ZOOM_MIN, value))
        : SKETCH_ZOOM_DEFAULT;
      zoomRef.current = next;
      setZoomState(next);
    },
    [selection]
  );
  toolRef.current = tool;
  const clear = useCallback(() => {
    if (hasContentRef.current) {
      const snapshot = captureSnapshot();
      if (snapshot) recordMutation(snapshot);
    }
    selection.clearSelectionWithoutHistory();
    const c = ctxRef.current;
    if (c) {
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = SKETCH_CANVAS_COLORS.background;
      c.fillRect(0, 0, c.canvas.width, c.canvas.height);
      c.restore();
    }
    updateHasContent(false);
  }, [captureSnapshot, recordMutation, selection, updateHasContent]);
  const bindCanvas = useCallback((canvas: HTMLCanvasElement) => {
    let cleanup: (() => void) | undefined;
    const setup = (): boolean => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      const dpr = window.devicePixelRatio || 1;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return true;
      ctxRef.current = ctx;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = SKETCH_CANVAS_COLORS.background;
      ctx.fillRect(0, 0, rect.width, rect.height);
      historyRef.current.reset();
      const selectionCleanup = selection.bindSelectionPointerHandlers(canvas, dpr);
      updateHasContent(false);
      setZoom(SKETCH_ZOOM_DEFAULT);
      canvas.style.touchAction = 'none';
      let drawing = false;
      let startX = 0;
      let startY = 0;
      let preStroke: ImageData | null = null;
      let hadContentBeforeStroke = false;
      const pointers = new Map<number, { clientX: number; clientY: number }>();
      let pinchStart: number | null = null;
      let pinchZoom = 1;
      const restorePreStroke = () => {
        if (preStroke) {
          ctx.putImageData(preStroke, 0, 0);
          updateHasContent(hadContentBeforeStroke);
        }
        drawing = false;
        preStroke = null;
      };
      const point = (e: PointerEvent) => {
        const r = canvas.getBoundingClientRect();
        return {
          x: ((e.clientX - r.left) * (canvas.width / r.width)) / dpr,
          y: ((e.clientY - r.top) * (canvas.height / r.height)) / dpr,
        };
      };
      const down = (e: PointerEvent) => {
        if (toolRef.current === 'select') return;
        pointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
        if (pointers.size >= 2) {
          restorePreStroke();
          const p = [...pointers.values()];
          pinchStart = Math.hypot(p[0].clientX - p[1].clientX, p[0].clientY - p[1].clientY);
          pinchZoom = zoomRef.current;
          return;
        }
        preStroke = ctx.getImageData(0, 0, canvas.width, canvas.height);
        hadContentBeforeStroke = hasContentRef.current;
        drawing = true;
        const p = point(e);
        startX = p.x;
        startY = p.y;
        canvas.setPointerCapture(e.pointerId);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
      };
      const move = (e: PointerEvent) => {
        if (toolRef.current === 'select') return;
        pointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
        if (pointers.size >= 2) {
          const p = [...pointers.values()];
          const d = Math.hypot(p[0].clientX - p[1].clientX, p[0].clientY - p[1].clientY);
          if (pinchStart) setZoom((pinchZoom * d) / pinchStart);
          return;
        }
        if (!drawing) return;
        const p = point(e);
        ctx.strokeStyle =
          toolRef.current === 'pen' ? brushColorRef.current : SKETCH_CANVAS_COLORS.background;
        ctx.lineWidth =
          toolRef.current === 'pen' ? SKETCH_PEN_WIDTH_CSS_PX : SKETCH_ERASER_WIDTH_CSS_PX;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        if (
          toolRef.current === 'pen' &&
          Math.hypot(p.x - startX, p.y - startY) > SKETCH_MIN_STROKE_DISTANCE_CSS_PX
        )
          updateHasContent(true);
      };
      const end = (e: PointerEvent) => {
        if (toolRef.current === 'select') return;
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinchStart = null;
        if (drawing && preStroke) {
          const final = ctx.getImageData(0, 0, canvas.width, canvas.height);
          if (!imageDataPixelsEqual(preStroke, final))
            recordMutation({ imageData: preStroke, hasContent: hadContentBeforeStroke });
          updateHasContent(sketchCanvasHasInk(final));
        }
        if (pointers.size === 0) preStroke = null;
        drawing = false;
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      };
      const cancel = (e: PointerEvent) => {
        if (toolRef.current === 'select') return;
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinchStart = null;
        restorePreStroke();
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      };
      canvas.addEventListener('pointerdown', down);
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', end);
      canvas.addEventListener('pointercancel', cancel);
      cleanup = () => {
        selectionCleanup();
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', end);
        canvas.removeEventListener('pointercancel', cancel);
      };
      return true;
    };
    if (setup()) return () => cleanup?.();
    const rafId = requestAnimationFrame(() => {
      setup();
    });
    return () => {
      cancelAnimationFrame(rafId);
      cleanup?.();
    };
  }, []);
  const exportPngFile = useCallback(
    () =>
      new Promise<File | null>((resolve) => {
        const canvas = canvasRef.current;
        if (!canvas) return resolve(null);
        try {
          selection.commitSelection({ recordHistory: false });
          canvas.toBlob(
            (blob) =>
              resolve(blob ? new File([blob], buildSketchFileName(), { type: 'image/png' }) : null),
            'image/png'
          );
        } catch {
          resolve(null);
        }
      }),
    [selection]
  );
  return {
    canvasRef,
    tool,
    setTool,
    hasContent,
    clear,
    exportPngFile,
    bindCanvas,
    brushColor,
    setBrushColor,
    zoom,
    setZoom,
    selectionMarquee: selection.marquee,
    floatingSelection: selection.selection,
    onResizeHandlePointerDown: (handle, e) => {
      const canvas = canvasRef.current;
      if (canvas)
        selection.onResizeHandlePointerDown(
          handle,
          canvas,
          e.nativeEvent,
          window.devicePixelRatio || 1
        );
    },
    deleteSelection: selection.deleteSelection,
    copySelection: selection.copySelection,
    pasteFromClipboard: selection.pasteFromClipboard,
    commitSelection: selection.commitSelection,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undo: undoHistory,
    redo: redoHistory,
  };
}
