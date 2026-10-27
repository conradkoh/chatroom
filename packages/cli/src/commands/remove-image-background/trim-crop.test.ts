import { describe, expect, it } from 'vitest';

import { cropRgba, trimRect } from './trim-crop.js';

function solidCanvas(width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data.set([index & 255, (index >> 8) & 255, 7, 255], index * 4);
  }
  return data;
}

describe('trimRect', () => {
  it('returns exactly the content box at padding 0', () => {
    expect(trimRect({ x: 10, y: 20, width: 30, height: 40 }, 100, 80, 0)).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
  });

  it('expands by padding and clamps to the canvas edges', () => {
    expect(trimRect({ x: 2, y: 3, width: 6, height: 5 }, 10, 10, 4)).toEqual({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
  });

  it('expands without clamping when there is room', () => {
    expect(trimRect({ x: 10, y: 10, width: 4, height: 4 }, 40, 40, 2)).toEqual({
      x: 8,
      y: 8,
      width: 8,
      height: 8,
    });
  });

  it('works for a 1x1 content box', () => {
    expect(trimRect({ x: 5, y: 5, width: 1, height: 1 }, 10, 10, 0)).toEqual({
      x: 5,
      y: 5,
      width: 1,
      height: 1,
    });
  });
});

describe('cropRgba', () => {
  it('copies exactly the source pixels in the rectangle', () => {
    const width = 6;
    const height = 5;
    const data = solidCanvas(width, height);
    const rect = { x: 1, y: 2, width: 3, height: 2 };

    const cropped = cropRgba(data, width, rect);

    expect(cropped.length).toBe(3 * 2 * 4);
    for (let row = 0; row < rect.height; row += 1) {
      for (let col = 0; col < rect.width; col += 1) {
        const source = ((rect.y + row) * width + rect.x + col) * 4;
        const target = (row * rect.width + col) * 4;
        expect(Array.from(cropped.subarray(target, target + 4))).toEqual(
          Array.from(data.subarray(source, source + 4))
        );
      }
    }
  });

  it('copies a 1x1 rectangle', () => {
    const data = solidCanvas(4, 4);
    const cropped = cropRgba(data, 4, { x: 2, y: 3, width: 1, height: 1 });
    expect(Array.from(cropped)).toEqual(
      Array.from(data.subarray((3 * 4 + 2) * 4, (3 * 4 + 2) * 4 + 4))
    );
  });
});
