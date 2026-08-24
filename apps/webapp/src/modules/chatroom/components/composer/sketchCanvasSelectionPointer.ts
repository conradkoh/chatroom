// fallow-ignore-file complexity
import {
  getCssToCanvasScale,
  mapClientPointToCanvas,
  type SketchPoint,
} from './sketchCanvasDrawing';
import {
  isUsableSketchSelection,
  normalizeSketchSelection,
  type SketchSelectionRect,
} from './sketchCanvasSelection';

export const shouldStartSketchSelection = (
  disabled: boolean,
  enabled: boolean,
  isPrimary: boolean,
  button: number,
  hasActivePointer: boolean
) => !disabled && enabled && isPrimary && button === 0 && !hasActivePointer;
export function mapPointerToSelectionDraft(
  canvas: HTMLCanvasElement,
  anchor: SketchPoint,
  clientX: number,
  clientY: number
): SketchSelectionRect | null {
  const p = mapClientPointToCanvas(clientX, clientY, canvas);
  return p ? normalizeSketchSelection(anchor, p) : null;
}
export type FinishSelectionResult =
  | { type: 'commit'; selection: SketchSelectionRect }
  | { type: 'restore'; selection: SketchSelectionRect | null }
  | { type: 'clear' };
export function resolveSelectionFinish(
  cancel: boolean,
  canvas: HTMLCanvasElement,
  draft: SketchSelectionRect | null,
  prior: SketchSelectionRect | null
): FinishSelectionResult {
  if (!cancel && draft && isUsableSketchSelection(draft, getCssToCanvasScale(canvas)))
    return { type: 'commit', selection: draft };
  return cancel ? { type: 'restore', selection: prior } : { type: 'clear' };
}
export function endSelectionPointer(canvas: HTMLCanvasElement, pointerId: number): void {
  if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
}
