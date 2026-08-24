import { describe, expect, it, vi } from 'vitest';

import { drawSketchBrushCursor } from './sketchCanvasBrushCursor';

function context() {
  return {
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    strokeStyle: '',
    lineWidth: 0,
    lineDashOffset: 0,
  } as unknown as CanvasRenderingContext2D;
}

describe('drawSketchBrushCursor', () => {
  it('clears the overlay when there is no point', () => {
    const ctx = context();
    drawSketchBrushCursor(ctx, null, 8, 3, 'brush');
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 1200, 900);
    expect(ctx.arc).not.toHaveBeenCalled();
  });

  it('draws a scaled double outline for brush', () => {
    const ctx = context();
    drawSketchBrushCursor(ctx, { x: 10, y: 20 }, 8, 3, 'brush');
    expect(ctx.arc).toHaveBeenCalledWith(10, 20, 12, 0, Math.PI * 2);
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
    expect(ctx.setLineDash).not.toHaveBeenCalled();
  });

  it('uses dashed strokes for eraser', () => {
    const ctx = context();
    drawSketchBrushCursor(ctx, { x: 10, y: 20 }, 8, 1, 'eraser');
    expect(ctx.setLineDash).toHaveBeenCalledWith([3, 3]);
  });
});
