'use client';

import { useCallback, useRef, useState, type RefObject } from 'react';

import {
  SKETCH_BRUSH_COLOR_DEFAULT,
  SKETCH_BRUSH_SIZE_DEFAULT,
  SKETCH_BRUSH_SIZE_MAX,
  SKETCH_BRUSH_SIZE_MIN,
  SKETCH_CANVAS_BACKGROUND,
  type SketchBrushColor,
} from './sketchConstants';
import { buildSketchFileName } from './sketchFileName';

export type UseSketchCanvasResult = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  brushColor: SketchBrushColor;
  setBrushColor: (color: SketchBrushColor) => void;
  brushSize: number;
  setBrushSize: (size: number) => void;
  hasContent: boolean;
  bindCanvas: (canvas: HTMLCanvasElement) => () => void;
  exportPngFile: () => Promise<File | null>;
};
type Point = { x: number; y: number };
type ActiveStroke = { pointerId: number; lastPoint: Point; size: number; color: SketchBrushColor };

export function useSketchCanvas(): UseSketchCanvasResult {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const brushSizeRef = useRef(SKETCH_BRUSH_SIZE_DEFAULT);
  const brushColorRef = useRef<SketchBrushColor>(SKETCH_BRUSH_COLOR_DEFAULT);
  const hasContentRef = useRef(false);
  const [brushColor, setBrushColorState] = useState<SketchBrushColor>(SKETCH_BRUSH_COLOR_DEFAULT);
  const [brushSize, setBrushSizeState] = useState(SKETCH_BRUSH_SIZE_DEFAULT);
  const [hasContent, setHasContent] = useState(false);
  const setBrushColor = useCallback((color: SketchBrushColor) => {
    brushColorRef.current = color;
    setBrushColorState(color);
  }, []);
  const setBrushSize = useCallback((size: number) => {
    const next = Math.min(SKETCH_BRUSH_SIZE_MAX, Math.max(SKETCH_BRUSH_SIZE_MIN, Math.round(size)));
    brushSizeRef.current = next;
    setBrushSizeState(next);
  }, []);
  const bindCanvas = useCallback((canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return () => {};
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.touchAction = 'none';
    const context = canvas.getContext('2d');
    if (!context) return () => {};
    contextRef.current = context;
    context.scale(dpr, dpr);
    context.fillStyle = SKETCH_CANVAS_BACKGROUND;
    context.fillRect(0, 0, rect.width, rect.height);
    let active: ActiveStroke | null = null;
    const point = (event: PointerEvent): Point => {
      const bounds = canvas.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    };
    const segment = (from: Point, to: Point, stroke: ActiveStroke) => {
      context.beginPath();
      context.lineWidth = stroke.size;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.strokeStyle = stroke.color;
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
    };
    const start = (event: PointerEvent) => {
      if (event.button !== 0 || active) return;
      active = {
        pointerId: event.pointerId,
        lastPoint: point(event),
        size: brushSizeRef.current,
        color: brushColorRef.current,
      };
      canvas.setPointerCapture(event.pointerId);
      segment(
        active.lastPoint,
        { x: active.lastPoint.x + 0.01, y: active.lastPoint.y + 0.01 },
        active
      );
      hasContentRef.current = true;
      setHasContent(true);
    };
    const move = (event: PointerEvent) => {
      if (!active || active.pointerId !== event.pointerId) return;
      const next = point(event);
      segment(active.lastPoint, next, active);
      active.lastPoint = next;
    };
    const end = (event: PointerEvent) => {
      if (!active || active.pointerId !== event.pointerId) return;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      active = null;
    };
    canvas.addEventListener('pointerdown', start);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    return () => {
      canvas.removeEventListener('pointerdown', start);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', end);
      canvas.removeEventListener('pointercancel', end);
      contextRef.current = null;
      active = null;
    };
  }, []);
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
  return {
    canvasRef,
    brushColor,
    setBrushColor,
    brushSize,
    setBrushSize,
    hasContent,
    bindCanvas,
    exportPngFile,
  };
}
