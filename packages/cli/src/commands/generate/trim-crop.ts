/**
 * Pure rectangle helpers for `remove-image-background --trim`.
 *
 * Trimming happens after keying: the opaque content box is expanded by padding
 * and clamped to the tile canvas, then exactly those RGBA rows are copied.
 */

export const MAX_TRIM_PADDING = 64;

export interface TrimRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Expand the content box by `padding` on all sides, clamped to the canvas. */
export function trimRect(
  contentBox: TrimRect,
  canvasWidth: number,
  canvasHeight: number,
  padding: number
): TrimRect {
  const x = Math.max(0, contentBox.x - padding);
  const y = Math.max(0, contentBox.y - padding);
  const right = Math.min(canvasWidth, contentBox.x + contentBox.width + padding);
  const bottom = Math.min(canvasHeight, contentBox.y + contentBox.height + padding);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

/** Copy the RGBA rows of `rect` from a full canvas. Pure. */
export function cropRgba(data: Uint8Array, canvasWidth: number, rect: TrimRect): Uint8Array {
  const rowBytes = rect.width * 4;
  const cropped = new Uint8Array(rowBytes * rect.height);
  for (let row = 0; row < rect.height; row += 1) {
    const sourceStart = ((rect.y + row) * canvasWidth + rect.x) * 4;
    cropped.set(data.subarray(sourceStart, sourceStart + rowBytes), row * rowBytes);
  }
  return cropped;
}
