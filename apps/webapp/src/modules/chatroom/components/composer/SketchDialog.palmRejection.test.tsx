import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SKETCH_CANVAS_HEIGHT, SKETCH_CANVAS_WIDTH } from './sketchConstants';
import { SketchDialog } from './SketchDialog';

// Regression: iPad + Apple Pencil palm rejection. A resting palm arrives as `pointerType: 'touch'`
// while the pencil arrives as `pointerType: 'pen'`. Palm contact must never paint, and must never
// block the pencil from starting a stroke.

function createContextStub() {
  const pixels = { data: new Uint8ClampedArray(4) } as unknown as ImageData; // unique per context
  return {
    pixels,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalCompositeOperation: 'source-over',
    lineDashOffset: 0,
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    strokeRect: vi.fn(),
    setLineDash: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn(() => pixels),
    putImageData: vi.fn(),
  };
}
type ContextStub = ReturnType<typeof createContextStub>;
// Per-canvas contexts:
const contexts = new Map<HTMLCanvasElement, ContextStub>();
const stubs = () => [...contexts.values()];

beforeEach(() => {
  vi.clearAllMocks();
  contexts.clear();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement
  ) {
    let c = contexts.get(this);
    if (!c) {
      c = createContextStub();
      contexts.set(this, c);
    }
    return c as unknown as CanvasRenderingContext2D;
  } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
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

const dotAt = (x: number, y: number) =>
  stubs().some((s) => s.arc.mock.calls.some(([cx, cy]) => cx === x && cy === y));
const segmentTo = (x: number, y: number) =>
  stubs().some((s) => s.lineTo.mock.calls.some(([lx, ly]) => lx === x && ly === y));
const getImageDataCalls = () => stubs().reduce((n, s) => n + s.getImageData.mock.calls.length, 0);

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

  it('does not read back the layer for a touch pointerdown or a finger tap', async () => {
    const canvas = renderCanvas();
    await act(async () => {
      fire(canvas, 'pointerdown', PALM, 250, 250);
    });
    expect(getImageDataCalls()).toBe(0);
    await act(async () => {
      fire(canvas, 'pointerup', PALM, 250, 250);
    });
    expect(dotAt(250, 250)).toBe(true);
    expect(getImageDataCalls()).toBe(0);
  });

  it('reads back the layer once when a touch stroke first paints', async () => {
    const canvas = renderCanvas();
    await act(async () => {
      fire(canvas, 'pointerdown', PALM, 250, 250);
      fire(canvas, 'pointermove', PALM, 260, 255);
      fire(canvas, 'pointermove', PALM, 280, 260);
    });
    expect(segmentTo(280, 260)).toBe(true);
    expect(getImageDataCalls()).toBe(1);
    const reader = stubs().find((s) => s.getImageData.mock.calls.length > 0);
    expect(reader?.getImageData).toHaveBeenCalledWith(
      0,
      0,
      SKETCH_CANVAS_WIDTH,
      SKETCH_CANVAS_HEIGHT
    );
  });

  describe('undoing palm marks', () => {
    it('restores the layer when the pencil lands after the palm moved', async () => {
      const canvas = renderCanvas();
      await act(async () => {
        fire(canvas, 'pointerdown', PALM, 300, 300);
        fire(canvas, 'pointermove', PALM, 320, 310);
        fire(canvas, 'pointerdown', PENCIL, 100, 100);
        fire(canvas, 'pointerup', PENCIL, 100, 100);
        fire(canvas, 'pointerup', PALM, 300, 300);
      });
      const target = stubs().find((s) =>
        s.lineTo.mock.calls.some(([x, y]) => x === 320 && y === 310)
      );
      expect(target?.putImageData).toHaveBeenCalledTimes(1);
      expect(target?.putImageData).toHaveBeenCalledWith(target?.pixels, 0, 0);
      expect(dotAt(100, 100)).toBe(true);
    });

    it('restores the layer when iPadOS cancels a touch stroke', async () => {
      const canvas = renderCanvas();
      await act(async () => {
        fire(canvas, 'pointerdown', PALM, 300, 300);
        fire(canvas, 'pointermove', PALM, 320, 310);
        fire(canvas, 'pointercancel', PALM, 320, 310);
      });
      const target = stubs().find((s) =>
        s.lineTo.mock.calls.some(([x, y]) => x === 320 && y === 310)
      );
      expect(target?.putImageData).toHaveBeenCalledWith(target?.pixels, 0, 0);
      // Restoring the pixels also restores that flag, so no scan is needed.
      expect(target?.getImageData).toHaveBeenCalledTimes(1);
      // The restored layer had no content, so there is still nothing to save.
      expect(screen.getByRole('button', { name: 'Add sketch' })).toBeDisabled();
    });

    it('restores only the layer the palm painted when the active layer changes before the pencil lands', async () => {
      vi.stubGlobal(
        'createImageBitmap',
        vi.fn(async () => ({ width: 40, height: 40, close: vi.fn() }))
      );
      const user = userEvent.setup();
      const canvas = renderCanvas();
      const paste = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', {
        value: {
          items: [
            {
              kind: 'file',
              type: 'image/png',
              getAsFile: () => new File(['x'], 'a.png', { type: 'image/png' }),
            },
          ],
        },
      });
      await act(async () => {
        document.dispatchEvent(paste);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      const apply = await screen.findByRole('button', { name: 'Apply' });
      // The paste import resolves asynchronously; Apply is disabled until it lands.
      await waitFor(() => expect(apply).toBeEnabled());
      await user.click(apply);
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull());
      // Pasting switches to the transform tool; the palm stroke below needs brush bindings.
      await user.keyboard('b');
      for (const stub of stubs()) stub.putImageData.mockClear();
      fireEvent.click(screen.getByRole('button', { name: /Drawing 1/ }));
      await act(async () => {
        fire(canvas, 'pointerdown', PALM, 300, 300);
        fire(canvas, 'pointermove', PALM, 320, 310);
      });
      fireEvent.click(screen.getByRole('button', { name: /Pasted image 1/ }));
      await act(async () => {
        fire(canvas, 'pointermove', PALM, 340, 320);
        fire(canvas, 'pointerdown', PENCIL, 100, 100);
        fire(canvas, 'pointerup', PENCIL, 100, 100);
        fire(canvas, 'pointerup', PALM, 300, 300);
      });
      const painted = stubs().filter((s) =>
        s.lineTo.mock.calls.some(([x, y]) => x === 320 && y === 310)
      );
      expect(painted).toHaveLength(1);
      const ctxA = painted[0] as ContextStub;
      const pencilled = stubs().filter((s) =>
        s.arc.mock.calls.some(([x, y]) => x === 100 && y === 100)
      );
      expect(pencilled).toHaveLength(1);
      const ctxB = pencilled[0] as ContextStub;
      expect(ctxA).not.toBe(ctxB);
      // The stroke stays pinned to the layer it started on, even after the layer switch.
      expect(ctxA.lineTo.mock.calls.some(([x, y]) => x === 340 && y === 320)).toBe(true);
      expect(ctxB.lineTo.mock.calls.some(([x, y]) => x === 340 && y === 320)).toBe(false);
      // Only the painted layer is restored.
      expect(ctxA.putImageData).toHaveBeenCalledTimes(1);
      expect(ctxA.putImageData).toHaveBeenCalledWith(ctxA.pixels, 0, 0);
      expect(ctxB.putImageData).not.toHaveBeenCalled();
    });
  });

  it('ignores a palm marquee in the Select tool after the pencil drew', async () => {
    const user = userEvent.setup();
    const canvas = renderCanvas();
    await act(async () => {
      fire(canvas, 'pointerdown', PENCIL, 100, 100);
      fire(canvas, 'pointerup', PENCIL, 100, 100);
    });
    await user.keyboard('m');
    await act(async () => {
      fire(canvas, 'pointerdown', PALM, 100, 100);
      fire(canvas, 'pointermove', PALM, 400, 300);
      fire(canvas, 'pointerup', PALM, 400, 300);
    });
    expect(screen.getByRole('button', { name: 'Delete selection' })).toBeDisabled();
  });

  it('lets a finger marquee select before any pencil is used', async () => {
    const user = userEvent.setup();
    const canvas = renderCanvas();
    await user.keyboard('m');
    await act(async () => {
      fire(canvas, 'pointerdown', PALM, 100, 100);
      fire(canvas, 'pointermove', PALM, 400, 300);
      fire(canvas, 'pointerup', PALM, 400, 300);
    });
    expect(screen.getByRole('button', { name: 'Delete selection' })).toBeEnabled();
  });
});
