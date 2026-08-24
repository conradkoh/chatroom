import type { SketchSelectionRect } from './sketchCanvasSelection';
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

// fallow-ignore-next-line unused-export
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

// fallow-ignore-next-line unused-export
export function fillSketchRegion(
  context: CanvasRenderingContext2D,
  selection: SketchSelectionRect
): void {
  const x = Math.max(0, Math.floor(selection.x));
  const y = Math.max(0, Math.floor(selection.y));
  const width = Math.min(SKETCH_CANVAS_WIDTH - x, Math.ceil(selection.width));
  const height = Math.min(SKETCH_CANVAS_HEIGHT - y, Math.ceil(selection.height));
  if (width <= 0 || height <= 0) return;
  context.fillStyle = SKETCH_CANVAS_BACKGROUND;
  context.fillRect(x, y, width, height);
}

export function clearSketchRegion(
  context: CanvasRenderingContext2D,
  selection: SketchSelectionRect
): void {
  const x = Math.max(0, Math.floor(selection.x));
  const y = Math.max(0, Math.floor(selection.y));
  const width = Math.min(SKETCH_CANVAS_WIDTH - x, Math.ceil(selection.width));
  const height = Math.min(SKETCH_CANVAS_HEIGHT - y, Math.ceil(selection.height));
  if (width > 0 && height > 0) context.clearRect(x, y, width, height);
}
export function drawSketchEraseDot(
  context: CanvasRenderingContext2D,
  point: SketchPoint,
  brushSize: number,
  cssToCanvasScale: number
): void {
  context.save();
  context.globalCompositeOperation = 'destination-out';
  context.beginPath();
  context.fillStyle = 'rgba(0,0,0,1)';
  context.arc(point.x, point.y, (brushSize * cssToCanvasScale) / 2, 0, Math.PI * 2);
  context.fill();
  context.restore();
}
export function drawSketchEraseSegment(
  context: CanvasRenderingContext2D,
  from: SketchPoint,
  to: SketchPoint,
  brushSize: number,
  cssToCanvasScale: number
): void {
  context.save();
  context.globalCompositeOperation = 'destination-out';
  context.strokeStyle = 'rgba(0,0,0,1)';
  context.lineWidth = brushSize * cssToCanvasScale;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
  context.restore();
}
export function createTransparentLayerBitmap(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SKETCH_CANVAS_WIDTH;
  canvas.height = SKETCH_CANVAS_HEIGHT;
  return canvas;
}
// fallow-ignore-next-line complexity
// fallow-ignore-next-line complexity unused-export
export function hasNonBackgroundSketchPixels(context: CanvasRenderingContext2D): boolean {
  const { data } = context.getImageData(0, 0, SKETCH_CANVAS_WIDTH, SKETCH_CANVAS_HEIGHT);
  for (let i = 0; i < data.length; i += 4)
    if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) return true;
  return false;
}
