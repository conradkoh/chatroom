import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSketchCanvas } from './useSketchCanvas';

function createCanvasTestContext() {
  const fillColors: string[] = [];
  const strokeColors: string[] = [];
  const context = {
    fillStyle: '',
    strokeStyle: '',
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    fillRect: vi.fn(() => fillColors.push(context.fillStyle)),
    scale: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(() => strokeColors.push(context.strokeStyle)),
    lineWidth: 0,
    lineCap: 'butt' as CanvasLineCap,
    lineJoin: 'miter' as CanvasLineJoin,
  };

  return {
    context: context as unknown as CanvasRenderingContext2D,
    fillColors,
    strokeColors,
  };
}

describe('useSketchCanvas theme colors', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark');
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  it('repaints the background and existing strokes when the theme changes', () => {
    const canvas = document.createElement('canvas');
    const { context, fillColors, strokeColors } = createCanvasTestContext();
    vi.spyOn(canvas, 'getContext').mockReturnValue(context);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      width: 320,
      height: 240,
      top: 0,
      left: 0,
      right: 320,
      bottom: 240,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    Object.defineProperties(canvas, {
      setPointerCapture: { value: vi.fn() },
      releasePointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn(() => false) },
    });

    const { result, rerender } = renderHook(() => useSketchCanvas());
    result.current.canvasRef.current = canvas;
    let dispose: (() => void) | undefined;
    act(() => {
      dispose = result.current.bindCanvas(canvas);
    });

    act(() => {
      canvas.dispatchEvent(
        new PointerEvent('pointerdown', { button: 0, pointerId: 1, clientX: 24, clientY: 32 })
      );
    });

    expect(fillColors.at(-1)).toBe('#ffffff');
    expect(strokeColors.at(-1)).toBe('#171717');

    document.documentElement.classList.add('dark');
    act(() => rerender());

    expect(fillColors.at(-1)).toBe('#09090b');
    expect(strokeColors.at(-1)).toBe('#fafafa');

    dispose?.();
  });
});
