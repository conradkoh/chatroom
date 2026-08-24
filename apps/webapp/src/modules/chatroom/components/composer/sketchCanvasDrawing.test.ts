import { describe, expect, it, vi } from 'vitest';

import {
  drawSketchDot,
  drawSketchSegment,
  fillSketchBackground,
  fillSketchRegion,
  getCssToCanvasScale,
  hasNonBackgroundSketchPixels,
  mapClientPointToCanvas,
} from './sketchCanvasDrawing';
import { SKETCH_CANVAS_HEIGHT, SKETCH_CANVAS_WIDTH } from './sketchConstants';

function canvas() {
  const el = document.createElement('canvas');
  el.width = SKETCH_CANVAS_WIDTH;
  el.height = SKETCH_CANVAS_HEIGHT;
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    width: 400,
    height: 300,
    top: 0,
    left: 0,
    right: 400,
    bottom: 300,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  return el;
}
function context() {
  return {
    fillStyle: '',
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    strokeStyle: '',
    lineWidth: 0,
    lineCap: 'butt',
    lineJoin: 'miter',
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}
describe('sketch drawing helpers', () => {
  it('maps CSS center and handles zero rectangles', () => {
    const el = canvas();
    expect(mapClientPointToCanvas(200, 150, el)).toEqual({ x: 600, y: 450 });
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ width: 0, height: 300 } as DOMRect);
    expect(mapClientPointToCanvas(1, 1, el)).toBeNull();
  });
  it('scales CSS pixels to canvas pixels', () => expect(getCssToCanvasScale(canvas())).toBe(3));
  it('fills the logical background', () => {
    const ctx = context();
    fillSketchBackground(ctx);
    expect(ctx.fillStyle).toBe('#ffffff');
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1200, 900);
  });
  it('draws a scaled dot', () => {
    const ctx = context();
    drawSketchDot(ctx, { x: 10, y: 20 }, { color: '#171717', size: 4 }, 3);
    expect(ctx.arc).toHaveBeenCalledWith(10, 20, 6, 0, Math.PI * 2);
    expect(ctx.fill).toHaveBeenCalled();
  });
  it('draws round scaled segments', () => {
    const ctx = context();
    drawSketchSegment(ctx, { x: 1, y: 2 }, { x: 3, y: 4 }, { color: '#171717', size: 4 }, 3);
    expect(ctx.lineWidth).toBe(12);
    expect(ctx.lineCap).toBe('round');
    expect(ctx.lineJoin).toBe('round');
    expect(ctx.stroke).toHaveBeenCalled();
  });
  it('fills a bounded white region', () => {
    const ctx = context();
    fillSketchRegion(ctx, { x: 10.2, y: 20.8, width: 50.1, height: 30.9 });
    expect(ctx.fillStyle).toBe('#ffffff');
    expect(ctx.fillRect).toHaveBeenCalledWith(10, 20, 51, 31);
  });
  it('detects non-background pixels in image data', () => {
    const ctx = {
      getImageData: vi
        .fn()
        .mockReturnValueOnce({
          data: new Uint8ClampedArray([255, 255, 255, 255]),
        })
        .mockReturnValueOnce({
          data: new Uint8ClampedArray([0, 0, 0, 255]),
        }),
    } as unknown as CanvasRenderingContext2D;
    expect(hasNonBackgroundSketchPixels(ctx)).toBe(false);
    expect(hasNonBackgroundSketchPixels(ctx)).toBe(true);
  });
});
