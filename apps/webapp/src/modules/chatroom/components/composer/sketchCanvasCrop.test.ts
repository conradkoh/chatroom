import { describe, expect, it, vi } from 'vitest';
import { extractImageDataRegion } from './sketchCanvasCrop';

describe('extractImageDataRegion', () => {
  it('extracts the backing-pixel region for CSS bounds', () => {
    const imageData = { width: 20, height: 12, data: new Uint8ClampedArray(20 * 12 * 4) } as ImageData;
    const getImageData = vi.fn(() => imageData);
    const ctx = { getImageData } as unknown as CanvasRenderingContext2D;
    expect(extractImageDataRegion(ctx, { x: 2, y: 3, width: 10, height: 6 }, 2)).toBe(imageData);
    expect(getImageData).toHaveBeenCalledWith(4, 6, 20, 12);
  });
});
