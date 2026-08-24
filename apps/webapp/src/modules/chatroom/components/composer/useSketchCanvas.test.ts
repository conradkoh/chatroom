import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  SKETCH_BRUSH_COLOR_DEFAULT,
  SKETCH_CANVAS_HEIGHT,
  SKETCH_CANVAS_WIDTH,
} from './sketchConstants';
import { useSketchCanvas } from './useSketchCanvas';

function setupCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = SKETCH_CANVAS_WIDTH;
  canvas.height = SKETCH_CANVAS_HEIGHT;
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
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
  const context = {
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
  vi.spyOn(canvas, 'getContext').mockReturnValue(context);
  Object.defineProperties(canvas, {
    setPointerCapture: { value: vi.fn() },
    releasePointerCapture: { value: vi.fn() },
    hasPointerCapture: { value: vi.fn(() => true) },
    toBlob: {
      value: (cb: (blob: Blob | null) => void) => cb(new Blob(['png'], { type: 'image/png' })),
    },
  });
  return { canvas, context };
}
function event(type: string, init: PointerEventInit = {}) {
  return new PointerEvent(type, {
    bubbles: true,
    isPrimary: true,
    pointerId: 1,
    button: 0,
    clientX: 100,
    clientY: 100,
    ...init,
  });
}
function props(type: string, canvas: HTMLCanvasElement, init: PointerEventInit = {}) {
  const nativeEvent = event(type, init);
  return {
    nativeEvent,
    currentTarget: canvas,
    target: canvas,
    isPrimary: nativeEvent.isPrimary,
    button: nativeEvent.button,
    pointerId: nativeEvent.pointerId,
    clientX: nativeEvent.clientX,
    clientY: nativeEvent.clientY,
  };
}
function hook(disabled = false) {
  const result = renderHook(() =>
    useSketchCanvas({ brushColor: SKETCH_BRUSH_COLOR_DEFAULT, brushSize: 4, disabled })
  ).result;
  return result;
}
function bind(result: ReturnType<typeof hook>, canvas: HTMLCanvasElement) {
  result.current.canvasRef.current = canvas;
}

describe('useSketchCanvas', () => {
  it('marks a click as content and draws a dot', () => {
    const { canvas, context } = setupCanvas();
    const result = hook();
    bind(result, canvas);
    act(() => result.current.canvasBindings.onPointerDown?.(props('pointerdown', canvas) as never));
    expect(result.current.hasContent).toBe(true);
    expect(context.arc).toHaveBeenCalled();
  });
  it('draws drag segments and ends on pointer up', () => {
    const { canvas, context } = setupCanvas();
    const result = hook();
    bind(result, canvas);
    act(() => {
      result.current.canvasBindings.onPointerDown?.(props('pointerdown', canvas) as never);
      result.current.canvasBindings.onPointerMove?.(
        props('pointermove', canvas, { clientX: 200 }) as never
      );
      result.current.canvasBindings.onPointerUp?.(props('pointerup', canvas) as never);
    });
    expect(context.stroke).toHaveBeenCalled();
    expect(canvas.releasePointerCapture).toHaveBeenCalled();
  });
  it('ignores secondary, non-primary, concurrent, and disabled input', () => {
    const { canvas } = setupCanvas();
    const result = hook();
    bind(result, canvas);
    act(() =>
      result.current.canvasBindings.onPointerDown?.(
        props('pointerdown', canvas, { button: 2 }) as never
      )
    );
    expect(result.current.hasContent).toBe(false);
    act(() =>
      result.current.canvasBindings.onPointerDown?.(
        props('pointerdown', canvas, { isPrimary: false }) as never
      )
    );
    expect(result.current.hasContent).toBe(false);
    const disabled = hook(true);
    bind(disabled, canvas);
    act(() =>
      disabled.current.canvasBindings.onPointerDown?.(props('pointerdown', canvas) as never)
    );
    expect(disabled.current.hasContent).toBe(false);
  });
  it('exports null when blank and a PNG after drawing', async () => {
    const { canvas } = setupCanvas();
    const blank = hook();
    bind(blank, canvas);
    await expect(blank.current.exportPngFile()).resolves.toBeNull();
    const result = hook();
    bind(result, canvas);
    act(() => result.current.canvasBindings.onPointerDown?.(props('pointerdown', canvas) as never));
    await expect(result.current.exportPngFile()).resolves.toMatchObject({ type: 'image/png' });
  });
  it('ends a stroke on pointer cancel', () => {
    const { canvas } = setupCanvas();
    const result = hook();
    bind(result, canvas);
    act(() => {
      result.current.canvasBindings.onPointerDown?.(props('pointerdown', canvas) as never);
      result.current.canvasBindings.onPointerCancel?.(props('pointercancel', canvas) as never);
    });
    expect(canvas.releasePointerCapture).toHaveBeenCalled();
  });
});
