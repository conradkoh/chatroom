// fallow-ignore-file complexity
import type { SketchPoint } from './sketchCanvasDrawing';
import { SKETCH_CANVAS_HEIGHT, SKETCH_CANVAS_WIDTH } from './sketchConstants';
import type { SketchTransform } from './sketchDocument';

export type SketchSelectionRect = { x: number; y: number; width: number; height: number };
export type SketchSelectionAction = 'select-all' | 'request-delete' | 'clear';
export const FULL_SKETCH_SELECTION: SketchSelectionRect = {
  x: 0,
  y: 0,
  width: SKETCH_CANVAS_WIDTH,
  height: SKETCH_CANVAS_HEIGHT,
};
const clamp = (p: SketchPoint): SketchPoint => ({
  x: Math.max(0, Math.min(SKETCH_CANVAS_WIDTH, p.x)),
  y: Math.max(0, Math.min(SKETCH_CANVAS_HEIGHT, p.y)),
});
export function normalizeSketchSelection(
  anchor: SketchPoint,
  current: SketchPoint
): SketchSelectionRect {
  const a = clamp(anchor);
  const c = clamp(current);
  return {
    x: Math.min(a.x, c.x),
    y: Math.min(a.y, c.y),
    width: Math.abs(c.x - a.x),
    height: Math.abs(c.y - a.y),
  };
}
export function isUsableSketchSelection(s: SketchSelectionRect, scale: number): boolean {
  return s.width >= 2 * scale && s.height >= 2 * scale;
}
export function isFullSketchSelection(s: SketchSelectionRect): boolean {
  return (
    s.x === FULL_SKETCH_SELECTION.x &&
    s.y === FULL_SKETCH_SELECTION.y &&
    s.width === FULL_SKETCH_SELECTION.width &&
    s.height === FULL_SKETCH_SELECTION.height
  );
}
function editable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return new Set(['INPUT', 'TEXTAREA', 'SELECT']).has(t.tagName) || t.isContentEditable;
}
export function resolveSketchSelectionAction(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'> & {
    target: EventTarget | null;
  },
  has: boolean
): SketchSelectionAction | null {
  if (editable(e.target)) return null;
  return resolveSelectAll(e) ?? resolveEscapeAction(e, has) ?? resolveDeleteAction(e, has);
}
function hasNoModifiers(
  e: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>
): boolean {
  return !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
}
function resolveSelectAll(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>
): SketchSelectionAction | null {
  if (!e.metaKey && !e.ctrlKey) return null;
  if (e.altKey || e.shiftKey) return null;
  return e.key.toLowerCase() === 'a' ? 'select-all' : null;
}
function resolveEscapeAction(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  has: boolean
): SketchSelectionAction | null {
  return hasNoModifiers(e) && e.key === 'Escape' && has ? 'clear' : null;
}
function resolveDeleteAction(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  has: boolean
): SketchSelectionAction | null {
  if (!hasNoModifiers(e) || !has) return null;
  return e.key === 'Delete' || e.key === 'Backspace' ? 'request-delete' : null;
}
export function drawSketchSelectionMarquee(
  ctx: CanvasRenderingContext2D,
  selection: SketchSelectionRect | null
): void {
  if (typeof ctx.clearRect !== 'function') return;
  ctx.clearRect(0, 0, SKETCH_CANVAS_WIDTH, SKETCH_CANVAS_HEIGHT);
  if (!selection) return;
  let { x, y, width, height } = selection;
  if (isFullSketchSelection(selection)) {
    x++;
    y++;
    width -= 2;
    height -= 2;
  }
  for (const [color, offset] of [
    ['#fff', 0],
    ['#000', 4],
  ] as const) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = offset;
    ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, width - 1), Math.max(0, height - 1));
    ctx.restore();
  }
}
export function drawSketchTransformOverlay(
  ctx: CanvasRenderingContext2D,
  t: SketchTransform,
  w: number,
  h: number,
  mode: 'move' | 'transform'
): void {
  ctx.clearRect(0, 0, SKETCH_CANVAS_WIDTH, SKETCH_CANVAS_HEIGHT);
  ctx.save();
  ctx.strokeStyle = '#fff';
  ctx.strokeRect(t.x + 0.5, t.y + 0.5, w * t.scaleX - 1, h * t.scaleY - 1);
  ctx.strokeStyle = '#000';
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(t.x + 0.5, t.y + 0.5, w * t.scaleX - 1, h * t.scaleY - 1);
  if (mode === 'transform')
    for (const p of [
      { x: t.x, y: t.y },
      { x: t.x + w * t.scaleX, y: t.y },
      { x: t.x + w * t.scaleX, y: t.y + h * t.scaleY },
      { x: t.x, y: t.y + h * t.scaleY },
    ]) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
      ctx.strokeStyle = '#000';
      ctx.strokeRect(p.x - 4, p.y - 4, 8, 8);
    }
  ctx.restore();
}
