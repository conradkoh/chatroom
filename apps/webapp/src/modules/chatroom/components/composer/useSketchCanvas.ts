'use client';
import { useCallback, useRef, useState, type RefObject } from 'react';

import {
  SKETCH_CANVAS_COLORS,
  SKETCH_ERASER_WIDTH_CSS_PX,
  SKETCH_MIN_STROKE_DISTANCE_CSS_PX,
  SKETCH_PEN_WIDTH_CSS_PX,
} from './sketchConstants';
import { buildSketchFileName } from './sketchFileName';

export type SketchTool = 'pen' | 'eraser';
export type UseSketchCanvasResult = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  tool: SketchTool;
  setTool: (tool: SketchTool) => void;
  hasContent: boolean;
  clear: () => void;
  exportPngFile: () => Promise<File | null>;
  bindCanvas: (canvas: HTMLCanvasElement) => () => void;
};
export function useSketchCanvas(): UseSketchCanvasResult {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const [tool, setTool] = useState<SketchTool>('pen');
  const [hasContent, setHasContent] = useState(false);
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const clear = useCallback(() => {
    const c = ctxRef.current;
    if (c) {
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = SKETCH_CANVAS_COLORS.background;
      c.fillRect(0, 0, c.canvas.width, c.canvas.height);
      c.restore();
    }
    setHasContent(false);
  }, []);
  const bindCanvas = useCallback((canvas: HTMLCanvasElement) => {
    const rect = canvas.parentElement?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return () => {};
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return () => {};
    ctxRef.current = ctx;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = SKETCH_CANVAS_COLORS.background;
    ctx.fillRect(0, 0, rect.width, rect.height);
    setHasContent(false);
    canvas.style.touchAction = 'none';
    let drawing = false;
    let startX = 0;
    let startY = 0;
    const point = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - r.left) * (canvas.width / r.width)) / dpr,
        y: ((e.clientY - r.top) * (canvas.height / r.height)) / dpr,
      };
    };
    const down = (e: PointerEvent) => {
      drawing = true;
      const p = point(e);
      startX = p.x;
      startY = p.y;
      canvas.setPointerCapture(e.pointerId);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    };
    const move = (e: PointerEvent) => {
      if (!drawing) return;
      const p = point(e);
      ctx.strokeStyle =
        toolRef.current === 'pen' ? SKETCH_CANVAS_COLORS.ink : SKETCH_CANVAS_COLORS.background;
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
        setHasContent(true);
    };
    const end = (e: PointerEvent) => {
      drawing = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', end);
      canvas.removeEventListener('pointercancel', end);
    };
  }, []);
  const exportPngFile = useCallback(
    () =>
      new Promise<File | null>((resolve) => {
        const canvas = canvasRef.current;
        if (!canvas) return resolve(null);
        try {
          canvas.toBlob(
            (blob) =>
              resolve(blob ? new File([blob], buildSketchFileName(), { type: 'image/png' }) : null),
            'image/png'
          );
        } catch {
          resolve(null);
        }
      }),
    []
  );
  return { canvasRef, tool, setTool, hasContent, clear, exportPngFile, bindCanvas };
}
