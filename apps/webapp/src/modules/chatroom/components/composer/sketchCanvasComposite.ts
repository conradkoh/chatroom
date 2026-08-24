// fallow-ignore-file unused-file
import {
  SKETCH_CANVAS_BACKGROUND,
  SKETCH_CANVAS_HEIGHT,
  SKETCH_CANVAS_WIDTH,
} from './sketchConstants';
import type { SketchTransform } from './sketchDocument';
import { applySketchTransform } from './sketchTransform';

export function renderSketchComposite(
  ctx: CanvasRenderingContext2D,
  bitmaps: readonly HTMLCanvasElement[],
  floating: { bitmap: CanvasImageSource; transform: SketchTransform } | null
): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = SKETCH_CANVAS_BACKGROUND;
  ctx.fillRect(0, 0, SKETCH_CANVAS_WIDTH, SKETCH_CANVAS_HEIGHT);
  for (const bitmap of bitmaps) ctx.drawImage(bitmap, 0, 0);
  if (floating)
    applySketchTransform(ctx, floating.transform, () => ctx.drawImage(floating.bitmap, 0, 0));
  ctx.restore();
}
export function layerHasNonTransparentPixels(ctx: CanvasRenderingContext2D): boolean {
  const { data } = ctx.getImageData(0, 0, SKETCH_CANVAS_WIDTH, SKETCH_CANVAS_HEIGHT);
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
  return false;
}
