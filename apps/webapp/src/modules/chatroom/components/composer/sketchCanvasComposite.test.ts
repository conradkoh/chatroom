import { describe, expect, it, vi } from 'vitest';

import { renderSketchComposite, layerHasNonTransparentPixels } from './sketchCanvasComposite';

describe('sketchCanvasComposite', () => {
  it('fills white and draws layers bottom to top', () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      setTransform: vi.fn(),
      fillStyle: '',
      globalCompositeOperation: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    renderSketchComposite(ctx, [{}, {}] as HTMLCanvasElement[], null);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1200, 900);
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);
  });
  it('scans alpha for transparent layers', () => {
    const ctx = {
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255]) })),
    } as unknown as CanvasRenderingContext2D;
    expect(layerHasNonTransparentPixels(ctx)).toBe(true);
  });
});
