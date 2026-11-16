import { mapClientPointToCanvas, type SketchBrush, type SketchPoint } from './sketchCanvasDrawing';

/** Pixels of the layer a touch stroke painted, from before its first paint; restored if the touch
 * turns out to be a palm. `hadContent` is that layer's hasContent flag at the same moment. */
export type SketchStrokeSnapshot = { layerId: string; pixels: ImageData; hadContent: boolean };

export type ActiveSketchStroke = {
  pointerId: number;
  pointerType: string;
  /** The layer this stroke paints into for its whole life, even if the active layer changes. */
  layerId: string;
  lastPoint: SketchPoint;
  brush: SketchBrush;
  /** Touch strokes paint their first dot on the first move (or on up for a tap), so a palm that
   * lands just before the pencil paints nothing. */
  pendingDot: boolean;
  /** Pixels of the layer a touch stroke painted, from before its first paint; restored if the touch
   * turns out to be a palm. `hadContent` is that layer's hasContent flag at the same moment. */
  snapshot: SketchStrokeSnapshot | null;
};

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
