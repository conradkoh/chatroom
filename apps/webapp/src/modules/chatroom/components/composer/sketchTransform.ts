// fallow-ignore-file unused-export
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
// fallow-ignore-next-line complexity
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
  const mids: [SketchTransformHandle, SketchPoint][] = [
    ['north', midpoint(corners[0], corners[1])],
    ['east', midpoint(corners[1], corners[2])],
    ['south', midpoint(corners[2], corners[3])],
    ['west', midpoint(corners[3], corners[0])],
  ];
  for (const [name, point] of mids)
    if (Math.hypot(p.x - point.x, p.y - point.y) <= 8 * scale) return name;
  const top = midpoint(corners[0], corners[1]);
  if (Math.hypot(p.x - top.x, p.y - top.y + 24 * scale) <= 8 * scale) return 'rotate';
  if (
    p.x >= Math.min(...corners.map((c) => c.x)) &&
    p.x <= Math.max(...corners.map((c) => c.x)) &&
    p.y >= Math.min(...corners.map((c) => c.y)) &&
    p.y <= Math.max(...corners.map((c) => c.y))
  )
    return 'move';
  return null;
}
const midpoint = (a: SketchPoint, b: SketchPoint): SketchPoint => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
export function translateTransform(t: SketchTransform, dx: number, dy: number): SketchTransform {
  return { ...t, x: t.x + dx, y: t.y + dy };
}
// fallow-ignore-next-line complexity
export function scaleTransformFromHandle(
  t: SketchTransform,
  handle: SketchTransformHandle,
  pointer: SketchPoint,
  start: SketchPoint,
  w: number,
  h: number,
  preserveAspect: boolean
): SketchTransform {
  const dx = pointer.x - start.x;
  const dy = pointer.y - start.y;
  const d = preserveAspect ? (Math.abs(dx) >= Math.abs(dy) ? dx / w : dy / h) : 0;
  const sx =
    handle.includes('east') || handle.includes('west')
      ? t.scaleX + (handle.includes('west') ? -dx / w : dx / w)
      : t.scaleX;
  const sy =
    handle.includes('north') || handle.includes('south')
      ? t.scaleY + (handle.includes('north') ? -dy / h : dy / h)
      : t.scaleY;
  return {
    ...t,
    scaleX: Math.max(0.01, preserveAspect ? t.scaleX + d : sx),
    scaleY: Math.max(0.01, preserveAspect ? t.scaleY + d : sy),
  };
}
export function rotateTransformFromHandle(
  t: SketchTransform,
  pointer: SketchPoint,
  start: SketchPoint,
  w: number,
  h: number
): SketchTransform {
  const c = { x: t.x + (w * t.scaleX) / 2, y: t.y + (h * t.scaleY) / 2 };
  return {
    ...t,
    rotationRadians:
      t.rotationRadians +
      Math.atan2(pointer.y - c.y, pointer.x - c.x) -
      Math.atan2(start.y - c.y, start.x - c.x),
  };
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
