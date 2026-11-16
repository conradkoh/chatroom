import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SKETCH_CANVAS_HEIGHT, SKETCH_CANVAS_WIDTH } from './sketchConstants';
import { SketchDialog } from './SketchDialog';

// Regression: iPad + Apple Pencil palm rejection. A resting palm arrives as `pointerType: 'touch'`
// while the pencil arrives as `pointerType: 'pen'`. Palm contact must never paint, and must never
// block the pencil from starting a stroke.

const ctx: {
  fillStyle: string;
  fillRect: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  arc: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  strokeStyle: string;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  getImageData?: ReturnType<typeof vi.fn>;
  putImageData?: ReturnType<typeof vi.fn>;
} = {
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
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D
  );
});

function setupCanvas(canvas: HTMLCanvasElement) {
  canvas.width = SKETCH_CANVAS_WIDTH;
  canvas.height = SKETCH_CANVAS_HEIGHT;
  // 1:1 CSS-to-canvas mapping so client coordinates equal canvas coordinates.
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    width: SKETCH_CANVAS_WIDTH,
    height: SKETCH_CANVAS_HEIGHT,
    top: 0,
    left: 0,
    right: SKETCH_CANVAS_WIDTH,
    bottom: SKETCH_CANVAS_HEIGHT,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  Object.defineProperties(canvas, {
    setPointerCapture: { value: vi.fn() },
    releasePointerCapture: { value: vi.fn() },
    hasPointerCapture: { value: vi.fn(() => true) },
  });
}

type Contact = { pointerId: number; pointerType: 'pen' | 'touch' };
const PALM: Contact = { pointerId: 2, pointerType: 'touch' };
const PENCIL: Contact = { pointerId: 3, pointerType: 'pen' };

function fire(
  canvas: HTMLCanvasElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  contact: Contact,
  x: number,
  y: number
) {
  // Per Pointer Events, `isPrimary` is tracked per pointer type: the first touch and the first pen
  // are both primary at the same time.
  canvas.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      button: type === 'pointermove' ? -1 : 0,
      isPrimary: true,
      clientX: x,
      clientY: y,
      ...contact,
    })
  );
}

const dotAt = (x: number, y: number) => ctx.arc.mock.calls.some(([cx, cy]) => cx === x && cy === y);
const segmentTo = (x: number, y: number) =>
  ctx.lineTo.mock.calls.some(([lx, ly]) => lx === x && ly === y);

function renderCanvas() {
  render(<SketchDialog open onOpenChange={vi.fn()} onSave={vi.fn()} />);
  const canvas = screen.getByLabelText('Sketch canvas') as HTMLCanvasElement;
  setupCanvas(canvas);
  return canvas;
}

describe('SketchDialog palm rejection (Apple Pencil)', () => {
  it('sanity: jsdom PointerEvent carries pointerType', () => {
    expect(new PointerEvent('pointerdown', { pointerType: 'pen' }).pointerType).toBe('pen');
  });

  it('draws the pencil stroke when the palm lands on the canvas first', async () => {
    const canvas = renderCanvas();
    await act(async () => {
      fire(canvas, 'pointerdown', PALM, 300, 300); // palm rests first
      fire(canvas, 'pointerdown', PENCIL, 100, 100); // pencil touches down
      fire(canvas, 'pointermove', PENCIL, 150, 120);
      fire(canvas, 'pointerup', PENCIL, 150, 120);
      fire(canvas, 'pointerup', PALM, 300, 300);
    });
    expect(dotAt(300, 300)).toBe(false); // palm must not paint
    expect(dotAt(100, 100)).toBe(true); // pencil stroke starts
    expect(segmentTo(150, 120)).toBe(true); // pencil stroke continues
  });

  it('ignores a palm moving across the canvas while the pencil is lifted mid-sketch', async () => {
    const canvas = renderCanvas();
    await act(async () => {
      fire(canvas, 'pointerdown', PENCIL, 100, 100);
      fire(canvas, 'pointerup', PENCIL, 100, 100);
      // Pencil lifted between strokes; palm shifts, creating a fresh touch contact.
      fire(canvas, 'pointerdown', PALM, 400, 400);
      fire(canvas, 'pointermove', PALM, 420, 410);
      fire(canvas, 'pointerup', PALM, 420, 410);
    });
    expect(dotAt(400, 400)).toBe(false);
    expect(segmentTo(420, 410)).toBe(false);
  });

  it('draws a finger stroke when no pencil has been used', async () => {
    const canvas = renderCanvas();
    await act(async () => {
      fire(canvas, 'pointerdown', PALM, 200, 200);
      fire(canvas, 'pointermove', PALM, 240, 220);
      fire(canvas, 'pointerup', PALM, 240, 220);
    });
    expect(dotAt(200, 200)).toBe(true);
    expect(segmentTo(240, 220)).toBe(true);
  });

  it('draws a dot for a finger tap when no pencil has been used', async () => {
    const canvas = renderCanvas();
    await act(async () => {
      fire(canvas, 'pointerdown', PALM, 250, 250);
      fire(canvas, 'pointerup', PALM, 250, 250);
    });
    expect(dotAt(250, 250)).toBe(true);
    expect(screen.getByRole('button', { name: 'Add sketch' })).toBeEnabled();
  });

  it('ignores a palm after the pencil hovers over the canvas', async () => {
    const canvas = renderCanvas();
    await act(async () => {
      fire(canvas, 'pointermove', PENCIL, 50, 50);
      fire(canvas, 'pointerdown', PALM, 400, 400);
      fire(canvas, 'pointermove', PALM, 420, 410);
      fire(canvas, 'pointerup', PALM, 420, 410);
    });
    expect(dotAt(400, 400)).toBe(false);
    expect(segmentTo(420, 410)).toBe(false);
  });

  describe('undoing palm marks', () => {
    const snapshot = { data: new Uint8ClampedArray(4) } as unknown as ImageData;

    beforeEach(() => {
      Object.assign(ctx, {
        getImageData: vi.fn(() => snapshot),
        putImageData: vi.fn(),
      });
    });

    afterEach(() => {
      delete (ctx as Record<string, unknown>).getImageData;
      delete (ctx as Record<string, unknown>).putImageData;
    });

    it('restores the layer when the pencil lands after the palm moved', async () => {
      const canvas = renderCanvas();
      await act(async () => {
        fire(canvas, 'pointerdown', PALM, 300, 300);
        fire(canvas, 'pointermove', PALM, 320, 310);
        fire(canvas, 'pointerdown', PENCIL, 100, 100);
        fire(canvas, 'pointerup', PENCIL, 100, 100);
        fire(canvas, 'pointerup', PALM, 300, 300);
      });
      expect(ctx.putImageData).toHaveBeenCalledWith(snapshot, 0, 0);
      expect(dotAt(100, 100)).toBe(true);
    });

    it('restores the layer when iPadOS cancels a touch stroke', async () => {
      const canvas = renderCanvas();
      await act(async () => {
        fire(canvas, 'pointerdown', PALM, 300, 300);
        fire(canvas, 'pointermove', PALM, 320, 310);
        fire(canvas, 'pointercancel', PALM, 320, 310);
      });
      expect(ctx.putImageData).toHaveBeenCalledWith(snapshot, 0, 0);
    });
  });
});
