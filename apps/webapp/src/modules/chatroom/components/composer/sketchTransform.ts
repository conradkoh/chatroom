// fallow-ignore-file unused-file unused-export
import type { SketchPoint } from './sketchCanvasDrawing';
import { SKETCH_CANVAS_HEIGHT, SKETCH_CANVAS_WIDTH } from './sketchConstants';
import type { SketchTransform } from './sketchDocument';

export type SketchTransformHandle =
  | 'move'
  | 'north'
  | 'south'
  | 'east'
  | 'west'
  | 'north-east'
  | 'north-west'
  | 'south-east'
  | 'south-west'
  | 'rotate';
export const IDENTITY_TRANSFORM: SketchTransform = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotationRadians: 0,
};
export function applySketchTransform(
  ctx: CanvasRenderingContext2D,
  t: SketchTransform,
  draw: () => void
): void {
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.rotate(t.rotationRadians);
  ctx.scale(t.scaleX, t.scaleY);
  draw();
  ctx.restore();
}
export function computeContainTransform(
  w: number,
  h: number,
  cw = SKETCH_CANVAS_WIDTH,
  ch = SKETCH_CANVAS_HEIGHT
): SketchTransform {
  const scale = Math.min(1, (0.9 * cw) / w, (0.9 * ch) / h);
  return {
    x: (cw - w * scale) / 2,
    y: (ch - h * scale) / 2,
    scaleX: scale,
    scaleY: scale,
    rotationRadians: 0,
  };
}
export function getTransformedCorners(t: SketchTransform, w: number, h: number): SketchPoint[] {
  const c = Math.cos(t.rotationRadians);
  const s = Math.sin(t.rotationRadians);
  return [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ].map(([x, y]) => ({
    x: t.x + (x * t.scaleX * c - y * t.scaleY * s),
    y: t.y + (x * t.scaleX * s + y * t.scaleY * c),
  }));
}
export function hitTestTransformHandle(
  p: SketchPoint,
  t: SketchTransform,
  w: number,
  h: number,
  scale: number
): SketchTransformHandle | null {
  const corners = getTransformedCorners(t, w, h);
  const names: SketchTransformHandle[] = ['north-west', 'north-east', 'south-east', 'south-west'];
  for (let i = 0; i < 4; i++)
    if (Math.hypot(p.x - corners[i].x, p.y - corners[i].y) <= 8 * scale) return names[i];
  return null;
}
// fallow-ignore-next-line complexity
export function clampTransformToCanvas(
  t: SketchTransform,
  w: number,
  h: number,
  minVisiblePx = 16
): SketchTransform {
  const corners = getTransformedCorners(t, w, h);
  const minX = Math.min(...corners.map((p) => p.x));
  const maxX = Math.max(...corners.map((p) => p.x));
  const minY = Math.min(...corners.map((p) => p.y));
  const maxY = Math.max(...corners.map((p) => p.y));
  let dx = 0;
  let dy = 0;
  if (maxX < minVisiblePx) dx = minVisiblePx - maxX;
  else if (minX > SKETCH_CANVAS_WIDTH - minVisiblePx)
    dx = SKETCH_CANVAS_WIDTH - minVisiblePx - minX;
  if (maxY < minVisiblePx) dy = minVisiblePx - maxY;
  else if (minY > SKETCH_CANVAS_HEIGHT - minVisiblePx)
    dy = SKETCH_CANVAS_HEIGHT - minVisiblePx - minY;
  return { ...t, x: t.x + dx, y: t.y + dy };
}
