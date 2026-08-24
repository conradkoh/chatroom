import { describe, expect, it } from 'vitest';

import {
  SKETCH_BRUSH_COLOR_DEFAULT,
  SKETCH_BRUSH_PALETTE,
  SKETCH_BRUSH_SIZE_MAX,
  SKETCH_BRUSH_SIZE_MIN,
  SKETCH_CANVAS_BACKGROUND,
  SKETCH_CANVAS_HEIGHT,
  SKETCH_CANVAS_WIDTH,
} from './sketchConstants';

describe('sketch constants', () => {
  it('defines the opaque MVP canvas and palette', () => {
    expect(SKETCH_CANVAS_BACKGROUND).toBe('#ffffff');
    expect(SKETCH_BRUSH_PALETTE).toHaveLength(8);
    expect(SKETCH_BRUSH_COLOR_DEFAULT).toBe('#171717');
  });
  it('keeps size bounds', () => {
    expect(SKETCH_BRUSH_SIZE_MIN).toBe(1);
    expect(SKETCH_BRUSH_SIZE_MAX).toBe(32);
  });
  it('defines stable 4:3 export dimensions', () => {
    expect(SKETCH_CANVAS_WIDTH).toBe(1200);
    expect(SKETCH_CANVAS_HEIGHT).toBe(900);
    expect(SKETCH_CANVAS_WIDTH / SKETCH_CANVAS_HEIGHT).toBe(4 / 3);
  });
});
