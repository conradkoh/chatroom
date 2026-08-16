import { toBackingRect } from './sketchCanvasCoords';
import type { SketchRect } from './sketchSelectionTypes';

export function clearBackingRectAlpha(data: ImageData, inner: SketchRect, dpr: number): ImageData {
  const out = new ImageData(data.width, data.height);
  out.data.set(data.data);
  const b = toBackingRect(inner, dpr);
  for (let y = b.y; y < b.y + b.height; y++) for (let x = b.x; x < b.x + b.width; x++) {
    const i = (y * data.width + x) * 4;
    out.data[i + 3] = 0;
  }
  return out;
}
