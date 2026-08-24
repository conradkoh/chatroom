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
import {
  endSketchStroke,
  getCoalescedPointerEvents,
  processCoalescedPointerMove,
  shouldStartSketchStroke,
  type ActiveSketchStroke,
} from './sketchCanvasPointer';
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
export function useSketchCanvas({
  brushColor,
  brushSize,
  disabled,
}: UseSketchCanvasArgs): UseSketchCanvasResult {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const hasContentRef = useRef(false);
  const activeStrokeRef = useRef<ActiveSketchStroke | null>(null);
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
  const onPointerDown: ComponentProps<'canvas'>['onPointerDown'] = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (
        !shouldStartSketchStroke(
          disabled,
          event.isPrimary,
          event.button,
          activeStrokeRef.current != null
        )
      )
        return;
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
      processCoalescedPointerMove(
        canvas,
        getCoalescedPointerEvents(event.nativeEvent),
        active,
        drawSegment
      );
    },
    [drawSegment]
  );
  const onPointerUp: ComponentProps<'canvas'>['onPointerUp'] = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current) return;
      endSketchStroke(canvasRef.current, event.pointerId, activeStrokeRef.current);
      if (activeStrokeRef.current?.pointerId === event.pointerId) activeStrokeRef.current = null;
    },
    []
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
