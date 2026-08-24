import type { SketchPoint } from './sketchCanvasDrawing';
import { SKETCH_CANVAS_HEIGHT, SKETCH_CANVAS_WIDTH } from './sketchConstants';

export type SketchBrushCursorVariant = 'brush' | 'eraser';

export function supportsSketchBrushCursor(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches
  );
}

// fallow-ignore-next-line complexity
export function drawSketchBrushCursor(
  ctx: CanvasRenderingContext2D,
  point: SketchPoint | null,
  brushSize: number,
  cssToCanvasScale: number,
  variant: SketchBrushCursorVariant
): void {
  if (typeof ctx.clearRect !== 'function') return;
  ctx.clearRect(0, 0, SKETCH_CANVAS_WIDTH, SKETCH_CANVAS_HEIGHT);
  if (!point) return;
  const radius = (brushSize * cssToCanvasScale) / 2;
  for (const [color, dashOffset] of [
    ['#fff', 0],
    ['#000', variant === 'eraser' ? 3 : 1],
  ] as const) {
    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    if (variant === 'eraser') {
      ctx.setLineDash([3, 3]);
      ctx.lineDashOffset = dashOffset;
    }
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
