import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SKETCH_CANVAS_HEIGHT, SKETCH_CANVAS_WIDTH } from '../sketchConstants';
import { SketchDialog } from '../SketchDialog';

// Only the document source is mocked so the floating selection is deterministic; useSketchManipulation
// stays real, so this exercises the cursor wiring from the hook through the session to the canvas.
// The floating rect (20,20 100×100, scale 1) places the NW handle at canvas (20,20), matching
// useSketchManipulation.test.tsx.
vi.mock('../useSketchDocument', () => {
  const canvasRef = { current: null as HTMLCanvasElement | null };
  const floating = {
    layerId: 'layer-1',
    sourceWidth: 100,
    sourceHeight: 100,
    transform: { x: 20, y: 20, scaleX: 1, scaleY: 1, rotationRadians: 0 },
    originRect: null,
    provenance: 'selection' as const,
    priorActiveLayerId: null,
  };
  return {
    useSketchDocument: () => ({
      canvasRef,
      canvasBindings: {},
      hasContent: true,
      exportPngFile: vi.fn(),
      deleteRegion: vi.fn(),
      selection: null,
      clearSelection: vi.fn(),
      onSelectionChange: vi.fn(),
      activeLayerId: 'layer-1',
      layers: [{ id: 'layer-1', name: 'Drawing 1', kind: 'paint', hasContent: true }],
      setActiveLayerId: vi.fn(),
      importPastedImage: vi.fn(),
      floating,
      beginFloatingSelection: vi.fn(),
      updateFloatingTransform: vi.fn(),
      applyFloatingSelection: vi.fn(),
      cancelFloatingSelection: vi.fn(),
      discardFloatingSelection: vi.fn(),
    }),
  };
});

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
    setLineDash: vi.fn(),
    lineDashOffset: 0,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D);
});

function setupCanvas(canvas: HTMLCanvasElement) {
  canvas.width = SKETCH_CANVAS_WIDTH;
  canvas.height = SKETCH_CANVAS_HEIGHT;
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

const renderDialog = () => render(<SketchDialog open onOpenChange={vi.fn()} onSave={vi.fn()} />);

const hoverCorner = async (canvas: HTMLCanvasElement) =>
  act(async () => {
    canvas.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        isPrimary: true,
        pointerId: 1,
        clientX: 20,
        clientY: 20,
      })
    );
  });

describe('sketch editor cursor wiring', () => {
  it('wires the manipulation cursor onto the canvas inline style for the transform tool', async () => {
    const user = userEvent.setup();
    renderDialog();
    const canvas = screen.getByLabelText('Sketch canvas') as HTMLCanvasElement;
    setupCanvas(canvas);
    await user.click(screen.getByRole('button', { name: 'Transform tool' }));
    // No handle yet: the transform tool reports the "outside the box" cursor.
    expect(canvas.style.cursor).toBe('default');
    await hoverCorner(canvas);
    expect(canvas.style.cursor).toBe('nwse-resize');
  });

  it('leaves the canvas without an inline cursor for the brush tool', async () => {
    renderDialog();
    const canvas = screen.getByLabelText('Sketch canvas') as HTMLCanvasElement;
    setupCanvas(canvas);
    await hoverCorner(canvas);
    expect(canvas.style.cursor).toBe('');
    expect(canvas.className).toContain('cursor-crosshair');
  });
});
