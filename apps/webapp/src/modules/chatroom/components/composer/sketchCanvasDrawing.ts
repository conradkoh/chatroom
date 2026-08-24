import {
  SKETCH_CANVAS_BACKGROUND,
  SKETCH_CANVAS_HEIGHT,
  SKETCH_CANVAS_WIDTH,
  type SketchBrushColor,
} from './sketchConstants';

export type SketchPoint = { x: number; y: number };
export type SketchBrush = { color: SketchBrushColor; size: number };

/** Map CSS layout pixels to logical canvas pixels. Returns null when rect is non-drawable. */
export function mapClientPointToCanvas(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement
): SketchPoint | null {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    x: (clientX - rect.left) * (canvas.width / rect.width),
    y: (clientY - rect.top) * (canvas.height / rect.height),
  };
}

export function getCssToCanvasScale(canvas: HTMLCanvasElement): number {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return 1;
  return canvas.width / rect.width;
}

export function fillSketchBackground(context: CanvasRenderingContext2D): void {
  context.fillStyle = SKETCH_CANVAS_BACKGROUND;
  context.fillRect(0, 0, SKETCH_CANVAS_WIDTH, SKETCH_CANVAS_HEIGHT);
}

export function drawSketchDot(
  context: CanvasRenderingContext2D,
  point: SketchPoint,
  brush: SketchBrush,
  cssToCanvasScale: number
): void {
  context.beginPath();
  context.fillStyle = brush.color;
  context.arc(point.x, point.y, (brush.size * cssToCanvasScale) / 2, 0, Math.PI * 2);
  context.fill();
}

export function drawSketchSegment(
  context: CanvasRenderingContext2D,
  from: SketchPoint,
  to: SketchPoint,
  brush: SketchBrush,
  cssToCanvasScale: number
): void {
  context.beginPath();
  context.strokeStyle = brush.color;
  context.lineWidth = brush.size * cssToCanvasScale;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
}
