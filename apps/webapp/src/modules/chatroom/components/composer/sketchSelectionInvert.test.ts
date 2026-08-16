import { describe, expect, it, vi } from 'vitest';
import { clearBackingRectAlpha } from './sketchSelectionInvert';

class TestImageData { width: number; height: number; data: Uint8ClampedArray; constructor(w: number, h: number) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); } }
vi.stubGlobal('ImageData', TestImageData);

describe('clearBackingRectAlpha', () => {
  it('clears only the inner backing pixel alpha', () => {
    const data = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(255) } as ImageData;
    const result = clearBackingRectAlpha(data, { x: 0, y: 0, width: 1, height: 1 }, 1);
    expect(result.data[3]).toBe(0);
    expect(result.data[7]).toBe(255);
    expect(result.data[11]).toBe(255);
    expect(result.data[15]).toBe(255);
  });
});
