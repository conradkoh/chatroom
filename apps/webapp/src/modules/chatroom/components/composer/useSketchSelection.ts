'use client';
import { useCallback, useRef, useState } from 'react';

import { canvasPointFromEvent, normalizeRect, pointInRect } from './sketchCanvasCoords';
import type { SketchHistorySnapshot } from './sketchCanvasSnapshot';
import { sketchCanvasHasInk } from './sketchCanvasSnapshot';
import { samplePixelHex } from './sketchColorSample';
// Resize uses canvas-space points so zoom does not affect geometry.
import {
  SKETCH_MIN_SELECTION_CSS_PX,
  type ResizeHandle,
  type SketchFloatingSelection,
  type SketchRect,
} from './sketchSelectionTypes';
import {
  drawImageDataAt,
  imageDataToPngBlob,
  imageBlobToImageData,
  fitImageDataToBounds,
  liftPixels,
  resizeBoundsFromHandle,
  scaleImageData,
  rotateImageData90Cw, flipImageDataHorizontal, flipImageDataVertical,
} from './sketchSelectionUtils';

type Mode = 'idle' | 'creating' | 'moving' | 'resizing';
export function useSketchSelection({
  getCtx,
  getCanvas,
  getDpr: _getDpr,
  updateHasContent,
  getHasContent: _getHasContent,
  onBeforeLift,
  onBeforeSelectionWrite,
  isHistoryRecording,
}: {
  getCtx: () => CanvasRenderingContext2D | null;
  getCanvas: () => HTMLCanvasElement | null;
  getDpr: () => number;
  updateHasContent: (v: boolean) => void;
  getHasContent: () => boolean;
  onBeforeLift?: () => void;
  onBeforeSelectionWrite?: () => void;
  isHistoryRecording?: () => boolean;
}) {
  const [marquee, setMarquee] = useState<SketchRect | null>(null);
  const [selection, setSelection] = useState<SketchFloatingSelection | null>(null);
  const marqueeRef = useRef<SketchRect | null>(null);
  const selectionRef = useRef<SketchFloatingSelection | null>(null);
  const baseRef = useRef<ImageData | null>(null);
  const mode = useRef<Mode>('idle');
  const start = useRef({ x: 0, y: 0 });
  const drag = useRef({ x: 0, y: 0 });
  const setSel = (v: SketchFloatingSelection | null) => {
    selectionRef.current = v;
    setSelection(v);
  };
  const redraw = useCallback(() => {
    const c = getCtx();
    const s = selectionRef.current;
    const b = baseRef.current;
    if (c && s && b) {
      c.putImageData(b, 0, 0);
      drawImageDataAt(c, s.imageData, s.bounds);
    }
  }, [getCtx]);
  const clearSelectionWithoutHistory = useCallback(() => {
    const c = getCtx();
    const b = baseRef.current;
    if (c && b) c.putImageData(b, 0, 0);
    baseRef.current = null;
    setSel(null);
    marqueeRef.current = null;
    setMarquee(null);
  }, [getCtx]);
  const captureCompositedSnapshot = useCallback((): SketchHistorySnapshot | null => {
    const c = getCtx();
    const target = getCanvas();
    if (!c || !target) return null;
    redraw();
    const imageData = c.getImageData(0, 0, target.width, target.height);
    return { imageData, hasContent: sketchCanvasHasInk(imageData) };
  }, [getCanvas, getCtx, redraw]);
  const sampleColorAt = useCallback((cssX: number, cssY: number, dpr: number): string | null => { const c = getCtx(); const target = getCanvas(); if (!c || !target) return null; if (selectionRef.current) redraw(); const x = Math.min(target.width - 1, Math.max(0, Math.floor(cssX * dpr))); const y = Math.min(target.height - 1, Math.max(0, Math.floor(cssY * dpr))); return samplePixelHex(c.getImageData(x, y, 1, 1), 0, 0); }, [getCanvas, getCtx, redraw]);
  const nudgeSelection = useCallback((dx: number, dy: number) => { const s = selectionRef.current; if (!s) return; setSel({ ...s, bounds: { ...s.bounds, x: s.bounds.x + dx, y: s.bounds.y + dy } }); redraw(); }, [redraw]);
  const rotateSelection90 = useCallback(() => { const s=selectionRef.current; if(!s)return; const cx=s.bounds.x+s.bounds.width/2, cy=s.bounds.y+s.bounds.height/2, w=s.bounds.height, h=s.bounds.width; setSel({imageData:rotateImageData90Cw(s.imageData),bounds:{x:cx-w/2,y:cy-h/2,width:w,height:h}}); redraw(); }, [redraw]);
  const flipSelectionHorizontal = useCallback(() => { const s=selectionRef.current; if(!s)return; setSel({...s,imageData:flipImageDataHorizontal(s.imageData)}); redraw(); }, [redraw]);
  const flipSelectionVertical = useCallback(() => { const s=selectionRef.current; if(!s)return; setSel({...s,imageData:flipImageDataVertical(s.imageData)}); redraw(); }, [redraw]);
  const commitSelection = useCallback(
    (options?: { recordHistory?: boolean }) => {
      const c = getCtx();
      const s = selectionRef.current;
      if (c && s) {
        if (options?.recordHistory !== false && isHistoryRecording?.() !== false)
          onBeforeSelectionWrite?.();
        drawImageDataAt(c, s.imageData, s.bounds);
      }
      baseRef.current = null;
      setSel(null);
      marqueeRef.current = null;
      setMarquee(null);
      if (s) updateHasContent(true);
    },
    [getCtx, isHistoryRecording, onBeforeSelectionWrite, updateHasContent]
  );
  const deleteSelection = useCallback(() => {
    if (isHistoryRecording?.() !== false) onBeforeSelectionWrite?.();
    const c = getCtx();
    const b = baseRef.current;
    if (c && b) c.putImageData(b, 0, 0);
    baseRef.current = null;
    setSel(null);
    marqueeRef.current = null;
    setMarquee(null);
  }, [getCtx, isHistoryRecording, onBeforeSelectionWrite]);
  const bindSelectionPointerHandlers = useCallback(
    (canvas: HTMLCanvasElement, dpr: number) => {
      const down = (e: PointerEvent) => {
        const p = canvasPointFromEvent(canvas, e, dpr);
        const s = selectionRef.current;
        if (s && pointInRect(p.x, p.y, s.bounds)) {
          mode.current = 'moving';
          start.current = p;
          drag.current = { x: s.bounds.x, y: s.bounds.y };
        } else {
          if (s) clearSelectionWithoutHistory();
          mode.current = 'creating';
          start.current = p;
        }
        canvas.setPointerCapture(e.pointerId);
      };
      const move = (e: PointerEvent) => {
        const p = canvasPointFromEvent(canvas, e, dpr);
        if (mode.current === 'creating') {
          const r = normalizeRect(start.current.x, start.current.y, p.x, p.y);
          marqueeRef.current = r;
          setMarquee(r);
        } else if (mode.current === 'moving' && selectionRef.current) {
          const s = selectionRef.current;
          setSel({
            ...s,
            bounds: {
              ...s.bounds,
              x: drag.current.x + p.x - start.current.x,
              y: drag.current.y + p.y - start.current.y,
            },
          });
          redraw();
        }
      };
      const up = (e: PointerEvent) => {
        if (mode.current === 'creating') {
          const r = marqueeRef.current;
          const c = getCtx();
          const target = getCanvas();
          if (
            r &&
            r.width >= SKETCH_MIN_SELECTION_CSS_PX &&
            r.height >= SKETCH_MIN_SELECTION_CSS_PX &&
            c &&
            target
          ) {
            if (isHistoryRecording?.() !== false) onBeforeLift?.();
            const data = liftPixels(c, target, r, dpr);
            if (data) {
              baseRef.current = c.getImageData(0, 0, target.width, target.height);
              setSel({ imageData: data, bounds: r });
            }
          } else {
            marqueeRef.current = null;
            setMarquee(null);
          }
        } else if (mode.current === 'moving') commitSelection({ recordHistory: true });
        mode.current = 'idle';
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      };
      canvas.addEventListener('pointerdown', down);
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('pointercancel', up);
      return () => {
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        canvas.removeEventListener('pointercancel', up);
      };
    },
    [clearSelectionWithoutHistory, commitSelection, getCanvas, getCtx, isHistoryRecording, onBeforeLift, redraw]
  );
  const onResizeHandlePointerDown = useCallback(
    (handle: ResizeHandle, canvas: HTMLCanvasElement, e: PointerEvent, dpr: number) => {
      e.stopPropagation();
      e.preventDefault();
      const s = selectionRef.current;
      if (!s) return;
      const startBounds = { ...s.bounds };
      const data = s.imageData;
      mode.current = 'resizing';
      const move = (ev: PointerEvent) => {
        const p = canvasPointFromEvent(canvas, ev, dpr);
        const bounds = resizeBoundsFromHandle(handle, startBounds, p);
        setSel({ imageData: scaleImageData(data, bounds.width, bounds.height), bounds });
        redraw();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        commitSelection({ recordHistory: true });
        mode.current = 'idle';
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [commitSelection, redraw]
  );
  const copySelection = useCallback(async () => {
    const s = selectionRef.current;
    if (!s) return;
    const blob = await imageDataToPngBlob(s.imageData);
    if (!blob) throw new Error('copy failed');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }, []);
  const pasteFromClipboard = useCallback(async () => {
    if (!navigator.clipboard?.read) throw new Error('clipboard unavailable');
    const items = await navigator.clipboard.read();
    let blob: Blob | null = null;
    for (const item of items) { if (item.types.includes('image/png')) { blob = await item.getType('image/png'); break; } }
    if (!blob) throw new Error('no image in clipboard');
    const canvas = getCanvas(); const ctx = getCtx();
    if (!canvas || !ctx) throw new Error('canvas unavailable');
    if (selectionRef.current) commitSelection({ recordHistory: false });
    const raw = await imageBlobToImageData(blob);
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.width / dpr; const cssH = canvas.height / dpr;
    const fitted = fitImageDataToBounds(raw, cssW * 0.9, cssH * 0.9);
    const bounds = { x: (cssW - fitted.width) / 2, y: (cssH - fitted.height) / 2, width: fitted.width, height: fitted.height };
    baseRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setSel({ imageData: fitted.imageData, bounds });
    redraw();
  }, [commitSelection, getCanvas, getCtx, redraw]);
  return {
    marquee,
    selection,
    activeHandle: null,
    bindSelectionPointerHandlers,
    onResizeHandlePointerDown,
    commitSelection,
    deleteSelection,
    copySelection,
    pasteFromClipboard,
    clearSelectionWithoutHistory,
    captureCompositedSnapshot,
    sampleColorAt,
    nudgeSelection,
    rotateSelection90, flipSelectionHorizontal, flipSelectionVertical,
    hasActiveSelection: () => selectionRef.current !== null,
  };
}
