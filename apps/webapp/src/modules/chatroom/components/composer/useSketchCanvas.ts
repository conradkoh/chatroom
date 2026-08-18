'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';

import {
  SKETCH_CANVAS_COLORS,
  SKETCH_BRUSH_SIZE_DEFAULT,
  SKETCH_BRUSH_SIZE_MAX,
  SKETCH_BRUSH_SIZE_MIN,
} from './sketchConstants';
import { buildSketchFileName } from './sketchFileName';

import type { ThemeAppearance } from '@/modules/theme/theme-utils';

export type UseSketchCanvasResult = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  brushSize: number;
  setBrushSize: (size: number) => void;
  hasContent: boolean;
  clear: () => void;
  bindCanvas: (canvas: HTMLCanvasElement) => () => void;
  exportPngFile: () => Promise<File | null>;
};

type SketchPoint = { x: number; y: number };
type SketchStroke = { points: SketchPoint[]; size: number };

function getSketchThemeAppearance(): ThemeAppearance {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) {
    return 'dark';
  }
  return 'light';
}

function subscribeToSketchTheme(onThemeChange: () => void) {
  if (typeof document === 'undefined') return () => {};

  const observer = new MutationObserver(onThemeChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

function drawSegment(
  context: CanvasRenderingContext2D,
  from: SketchPoint,
  to: SketchPoint,
  size: number,
  ink: string
) {
  context.save();
  context.beginPath();
  context.lineWidth = size;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = ink;
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
  context.restore();
}

function drawStroke(context: CanvasRenderingContext2D, stroke: SketchStroke, ink: string) {
  const [firstPoint] = stroke.points;
  if (!firstPoint) return;

  if (stroke.points.length === 1) {
    drawSegment(
      context,
      firstPoint,
      { x: firstPoint.x + 0.01, y: firstPoint.y + 0.01 },
      stroke.size,
      ink
    );
    return;
  }

  for (let index = 1; index < stroke.points.length; index += 1) {
    drawSegment(context, stroke.points[index - 1], stroke.points[index], stroke.size, ink);
  }
}

/**
 * The MVP sketch editor intentionally supports one theme-aware pen.
 * Pointer events cover mouse, touch, and stylus without separate input paths.
 */
export function useSketchCanvas(): UseSketchCanvasResult {
  const appearance = useSyncExternalStore(
    subscribeToSketchTheme,
    getSketchThemeAppearance,
    () => 'light' as ThemeAppearance
  );
  const colors = SKETCH_CANVAS_COLORS[appearance];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const colorsRef = useRef(colors);
  const strokesRef = useRef<SketchStroke[]>([]);
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

  const repaintCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const context = contextRef.current;
    if (!canvas || !context) return;

    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = colorsRef.current.background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();

    for (const stroke of strokesRef.current) {
      drawStroke(context, stroke, colorsRef.current.ink);
    }
  }, []);

  useEffect(() => {
    colorsRef.current = colors;
    repaintCanvas();
  }, [colors, repaintCanvas]);

  const clear = useCallback(() => {
    strokesRef.current = [];
    repaintCanvas();
    const canvas = canvasRef.current;
    const context = contextRef.current;
    if (!canvas || !context) return;
    updateHasContent(false);
  }, [repaintCanvas, updateHasContent]);

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
        strokesRef.current = [];
        repaintCanvas();
        updateHasContent(false);

        let drawing = false;
        let activePointerId: number | null = null;
        let activeStroke: SketchStroke | null = null;
        const point = (event: PointerEvent) => {
          const bounds = canvas.getBoundingClientRect();
          return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
        };
        const start = (event: PointerEvent) => {
          if (event.button !== 0 || drawing) return;
          drawing = true;
          activePointerId = event.pointerId;
          canvas.setPointerCapture(event.pointerId);
          const startPoint = point(event);
          activeStroke = { points: [startPoint], size: brushSizeRef.current };
          strokesRef.current.push(activeStroke);
          drawStroke(context, activeStroke, colorsRef.current.ink);
          updateHasContent(true);
        };
        const move = (event: PointerEvent) => {
          if (!drawing || activePointerId !== event.pointerId || !activeStroke) return;
          const nextPoint = point(event);
          const previousPoint = activeStroke.points[activeStroke.points.length - 1];
          activeStroke.points.push(nextPoint);
          drawSegment(context, previousPoint, nextPoint, activeStroke.size, colorsRef.current.ink);
        };
        const end = (event: PointerEvent) => {
          if (activePointerId !== event.pointerId) return;
          drawing = false;
          activePointerId = null;
          activeStroke = null;
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
          activeStroke = null;
          activePointerId = null;
          drawing = false;
          contextRef.current = null;
        };
      };

      frame = requestAnimationFrame(setup);
      return () => {
        cancelAnimationFrame(frame);
        cleanup?.();
      };
    },
    [repaintCanvas, updateHasContent]
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
