'use client';

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

import {
  drawSketchDot,
  drawSketchSegment,
  fillSketchBackground,
  getCssToCanvasScale,
  mapClientPointToCanvas,
  type SketchBrush,
  type SketchPoint,
} from './sketchCanvasDrawing';
import { type SketchBrushColor } from './sketchConstants';
import { buildSketchFileName } from './sketchFileName';

export type UseSketchCanvasArgs = {
  brushColor: SketchBrushColor;
  brushSize: number;
  disabled: boolean;
};
export type UseSketchCanvasResult = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  canvasBindings: Pick<
    ComponentProps<'canvas'>,
    'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onLostPointerCapture'
  >;
  hasContent: boolean;
  exportPngFile: () => Promise<File | null>;
};
type ActiveStroke = { pointerId: number; lastPoint: SketchPoint; brush: SketchBrush };

// fallow-ignore-next-line complexity
export function useSketchCanvas({
  brushColor,
  brushSize,
  disabled,
}: UseSketchCanvasArgs): UseSketchCanvasResult {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const hasContentRef = useRef(false);
  const activeStrokeRef = useRef<ActiveStroke | null>(null);
  const [hasContent, setHasContent] = useState(false);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    contextRef.current = context;
    fillSketchBackground(context);
    hasContentRef.current = false;
    setHasContent(false);
    activeStrokeRef.current = null;
  }, []);

  const markHasContent = useCallback(() => {
    if (!hasContentRef.current) {
      hasContentRef.current = true;
      setHasContent(true);
    }
  }, []);
  const drawAt = useCallback(
    (point: SketchPoint, brush: SketchBrush, canvas: HTMLCanvasElement) => {
      const context = contextRef.current ?? canvas.getContext('2d');
      if (!context) return;
      contextRef.current = context;
      drawSketchDot(context, point, brush, getCssToCanvasScale(canvas));
      markHasContent();
    },
    [markHasContent]
  );
  const drawSegment = useCallback(
    (from: SketchPoint, to: SketchPoint, brush: SketchBrush, canvas: HTMLCanvasElement) => {
      const context = contextRef.current ?? canvas.getContext('2d');
      if (!context) return;
      contextRef.current = context;
      drawSketchSegment(context, from, to, brush, getCssToCanvasScale(canvas));
      markHasContent();
    },
    [markHasContent]
  );
  const endStroke = useCallback((canvas: HTMLCanvasElement, pointerId: number) => {
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    if (activeStrokeRef.current?.pointerId === pointerId) activeStrokeRef.current = null;
  }, []);

  const onPointerDown: ComponentProps<'canvas'>['onPointerDown'] = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (disabled || !event.isPrimary || event.button !== 0 || activeStrokeRef.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const point = mapClientPointToCanvas(event.clientX, event.clientY, canvas);
      if (!point) return;
      const brush: SketchBrush = { color: brushColor, size: brushSize };
      drawAt(point, brush, canvas);
      activeStrokeRef.current = { pointerId: event.pointerId, lastPoint: point, brush };
      canvas.setPointerCapture(event.pointerId);
    },
    [brushColor, brushSize, disabled, drawAt]
  );
  const onPointerMove: ComponentProps<'canvas'>['onPointerMove'] = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const active = activeStrokeRef.current;
      if (!canvas || !active || active.pointerId !== event.pointerId) return;
      const coalesced =
        typeof event.nativeEvent.getCoalescedEvents === 'function'
          ? event.nativeEvent.getCoalescedEvents()
          : [];
      const events = coalesced.length ? coalesced : [event.nativeEvent];
      for (const coalesced of events) {
        const point = mapClientPointToCanvas(coalesced.clientX, coalesced.clientY, canvas);
        if (!point) continue;
        drawSegment(active.lastPoint, point, active.brush, canvas);
        active.lastPoint = point;
      }
    },
    [drawSegment]
  );
  const onPointerUp: ComponentProps<'canvas'>['onPointerUp'] = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (canvasRef.current) endStroke(canvasRef.current, event.pointerId);
    },
    [endStroke]
  );
  const onPointerCancel: ComponentProps<'canvas'>['onPointerCancel'] = onPointerUp;
  const onLostPointerCapture: ComponentProps<'canvas'>['onLostPointerCapture'] = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (activeStrokeRef.current?.pointerId === event.pointerId) activeStrokeRef.current = null;
    },
    []
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
  return {
    canvasRef,
    canvasBindings: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture,
    },
    hasContent,
    exportPngFile,
  };
}
