'use client';

import { useCallback, useRef, useState, type RefObject } from 'react';

import {
  SKETCH_CANVAS_COLORS,
  SKETCH_BRUSH_SIZE_DEFAULT,
  SKETCH_BRUSH_SIZE_MAX,
  SKETCH_BRUSH_SIZE_MIN,
} from './sketchConstants';
import { buildSketchFileName } from './sketchFileName';

export type UseSketchCanvasResult = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  brushSize: number;
  setBrushSize: (size: number) => void;
  hasContent: boolean;
  clear: () => void;
  bindCanvas: (canvas: HTMLCanvasElement) => () => void;
  exportPngFile: () => Promise<File | null>;
};

/**
 * The MVP sketch editor intentionally supports one tool: a black pen.
 * Pointer events cover mouse, touch, and stylus without separate input paths.
 */
export function useSketchCanvas(): UseSketchCanvasResult {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const [brushSize, setBrushSizeState] = useState(SKETCH_BRUSH_SIZE_DEFAULT);
  const [hasContent, setHasContent] = useState(false);
  const brushSizeRef = useRef(brushSize);
  const hasContentRef = useRef(false);

  const setBrushSize = useCallback((size: number) => {
    const next = Math.min(SKETCH_BRUSH_SIZE_MAX, Math.max(SKETCH_BRUSH_SIZE_MIN, Math.round(size)));
    brushSizeRef.current = next;
    setBrushSizeState(next);
  }, []);

  const updateHasContent = useCallback((value: boolean) => {
    hasContentRef.current = value;
    setHasContent(value);
  }, []);

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const context = contextRef.current;
    if (!canvas || !context) return;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = SKETCH_CANVAS_COLORS.background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();
    updateHasContent(false);
  }, [updateHasContent]);

  const bindCanvas = useCallback(
    (canvas: HTMLCanvasElement) => {
      let cleanup: (() => void) | undefined;
      let frame = 0;

      const setup = () => {
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          frame = requestAnimationFrame(setup);
          return;
        }

        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        canvas.style.touchAction = 'none';
        const context = canvas.getContext('2d');
        if (!context) return;
        contextRef.current = context;
        context.scale(dpr, dpr);
        context.fillStyle = SKETCH_CANVAS_COLORS.background;
        context.fillRect(0, 0, rect.width, rect.height);
        updateHasContent(false);

        let drawing = false;
        const point = (event: PointerEvent) => {
          const bounds = canvas.getBoundingClientRect();
          return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
        };
        const start = (event: PointerEvent) => {
          if (event.button !== 0) return;
          drawing = true;
          canvas.setPointerCapture(event.pointerId);
          const { x, y } = point(event);
          context.beginPath();
          context.moveTo(x, y);
          context.lineWidth = brushSizeRef.current;
          context.lineCap = 'round';
          context.lineJoin = 'round';
          context.strokeStyle = SKETCH_CANVAS_COLORS.ink;
          context.lineTo(x + 0.01, y + 0.01);
          context.stroke();
          updateHasContent(true);
        };
        const move = (event: PointerEvent) => {
          if (!drawing) return;
          const { x, y } = point(event);
          context.lineWidth = brushSizeRef.current;
          context.lineTo(x, y);
          context.stroke();
        };
        const end = (event: PointerEvent) => {
          drawing = false;
          if (canvas.hasPointerCapture(event.pointerId))
            canvas.releasePointerCapture(event.pointerId);
        };

        canvas.addEventListener('pointerdown', start);
        canvas.addEventListener('pointermove', move);
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
        cleanup = () => {
          canvas.removeEventListener('pointerdown', start);
          canvas.removeEventListener('pointermove', move);
          canvas.removeEventListener('pointerup', end);
          canvas.removeEventListener('pointercancel', end);
          contextRef.current = null;
        };
      };

      frame = requestAnimationFrame(setup);
      return () => {
        cancelAnimationFrame(frame);
        cleanup?.();
      };
    },
    [updateHasContent]
  );

  const exportPngFile = useCallback(
    () =>
      new Promise<File | null>((resolve) => {
        const canvas = canvasRef.current;
        if (!canvas || !hasContentRef.current) return resolve(null);
        canvas.toBlob(
          (blob) =>
            resolve(blob ? new File([blob], buildSketchFileName(), { type: 'image/png' }) : null),
          'image/png'
        );
      }),
    []
  );

  return { canvasRef, brushSize, setBrushSize, hasContent, clear, bindCanvas, exportPngFile };
}
