import { describe, expect, it } from 'vitest';

import { SKETCH_CANVAS_COLORS } from './sketchConstants';

describe('SKETCH_CANVAS_COLORS', () => {
  it('keeps the canvas and pen colors readable in light mode', () => {
    expect(SKETCH_CANVAS_COLORS.light).toEqual({
      background: '#ffffff',
      ink: '#171717',
    });
  });

  it('keeps the canvas and pen colors readable in dark mode', () => {
    expect(SKETCH_CANVAS_COLORS.dark).toEqual({
      background: '#09090b',
      ink: '#fafafa',
    });
  });
});
