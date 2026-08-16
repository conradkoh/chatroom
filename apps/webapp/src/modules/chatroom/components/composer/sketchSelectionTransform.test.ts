import { describe, expect, it, vi } from 'vitest';

import {
  flipImageDataHorizontal,
  flipImageDataVertical,
  rotateImageData90Cw,
} from './sketchSelectionUtils';

class TestImageData {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

vi.stubGlobal('ImageData', TestImageData);

function fixture(): ImageData {
  const data = new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 0, 255,
  ]);
  return { width: 2, height: 2, data } as ImageData;
}

describe('sketch selection transforms', () => {
  it('rotates clockwise and swaps dimensions', () => {
    const result = rotateImageData90Cw(fixture());
    expect([result.width, result.height]).toEqual([2, 2]);
  });

  it('flips horizontally while preserving dimensions', () => {
    const result = flipImageDataHorizontal(fixture());
    expect([result.width, result.height]).toEqual([2, 2]);
    expect(Array.from(result.data.slice(0, 8))).toEqual([0, 255, 0, 255, 255, 0, 0, 255]);
  });

  it('flips vertically while preserving dimensions', () => {
    const result = flipImageDataVertical(fixture());
    expect([result.width, result.height]).toEqual([2, 2]);
    expect(Array.from(result.data.slice(0, 8))).toEqual([0, 0, 255, 255, 255, 255, 0, 255]);
  });
});
