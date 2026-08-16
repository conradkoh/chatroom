import { toBackingRect } from './sketchCanvasCoords';
import { sketchCanvasHasInk } from './sketchCanvasSnapshot';
import type { SketchRect } from './sketchSelectionTypes';

export function extractImageDataRegion(ctx: CanvasRenderingContext2D, bounds: SketchRect, dpr: number): ImageData {
  const b = toBackingRect(bounds, dpr);
  return ctx.getImageData(b.x, b.y, b.width, b.height);
}

export function applyCroppedCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, cropped: ImageData, cssWidth: number, cssHeight: number, dpr: number): boolean {
  canvas.width = Math.max(1, Math.round(cssWidth * dpr));
  canvas.height = Math.max(1, Math.round(cssHeight * dpr));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.putImageData(cropped, 0, 0);
  return sketchCanvasHasInk(cropped);
}
