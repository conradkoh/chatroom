import { mapClientPointToCanvas, type SketchBrush, type SketchPoint } from './sketchCanvasDrawing';

export type ActiveSketchStroke = { pointerId: number; lastPoint: SketchPoint; brush: SketchBrush };

export function shouldStartSketchStroke(
  disabled: boolean,
  isPrimary: boolean,
  button: number,
  hasActiveStroke: boolean
): boolean {
  return !disabled && isPrimary && button === 0 && !hasActiveStroke;
}

export function getCoalescedPointerEvents(event: PointerEvent): PointerEvent[] {
  if (typeof event.getCoalescedEvents !== 'function') return [event];
  const coalesced = event.getCoalescedEvents();
  return coalesced.length ? coalesced : [event];
}

export function processCoalescedPointerMove(
  canvas: HTMLCanvasElement,
  events: PointerEvent[],
  active: ActiveSketchStroke,
  drawSegment: (
    from: SketchPoint,
    to: SketchPoint,
    brush: SketchBrush,
    canvas: HTMLCanvasElement
  ) => void
): void {
  for (const event of events) {
    const point = mapClientPointToCanvas(event.clientX, event.clientY, canvas);
    if (!point) continue;
    drawSegment(active.lastPoint, point, active.brush, canvas);
    active.lastPoint = point;
  }
}

export function endSketchStroke(
  canvas: HTMLCanvasElement,
  pointerId: number,
  _active: ActiveSketchStroke | null
): void {
  if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
}
