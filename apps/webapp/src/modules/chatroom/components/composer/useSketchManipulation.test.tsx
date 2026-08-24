import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useSketchManipulation } from './useSketchManipulation';

const meta = {
  layerId: 'l',
  sourceWidth: 100,
  sourceHeight: 100,
  transform: { x: 20, y: 20, scaleX: 1, scaleY: 1, rotationRadians: 0 },
  originRect: null,
  provenance: 'selection' as const,
  priorActiveLayerId: null,
};
function setup() {
  const c = document.createElement('canvas');
  c.width = 1200;
  c.height = 900;
  vi.spyOn(c, 'getBoundingClientRect').mockReturnValue({
    width: 1200,
    height: 900,
    top: 0,
    left: 0,
    right: 1200,
    bottom: 900,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  Object.defineProperties(c, {
    setPointerCapture: { value: vi.fn() },
    releasePointerCapture: { value: vi.fn() },
    hasPointerCapture: { value: vi.fn(() => true) },
  });
  return c;
}
const event = (c: HTMLCanvasElement, x: number, y: number) =>
  ({
    currentTarget: c,
    target: c,
    isPrimary: true,
    button: 0,
    pointerId: 1,
    clientX: x,
    clientY: y,
    nativeEvent: new PointerEvent('pointermove'),
  }) as never;
describe('useSketchManipulation', () => {
  it('begins floating synchronously and preserves pointer-up transform', () => {
    const c = setup();
    const begin = vi.fn(() => meta);
    const update = vi.fn();
    let floating: null | typeof meta = null;
    const h = renderHook(() =>
      useSketchManipulation({
        canvasRef: { current: c },
        overlayRef: { current: null },
        activeTool: 'move',
        disabled: false,
        selection: { layerId: 'l', rect: { x: 20, y: 20, width: 100, height: 100 } },
        floating,
        beginFloatingSelection: begin,
        updateFloatingTransform: update,
      })
    );
    act(() => h.result.current.manipulationBindings.onPointerDown?.(event(c, 30, 30)));
    floating = meta;
    h.rerender();
    act(() => h.result.current.manipulationBindings.onPointerMove?.(event(c, 50, 50)));
    act(() => h.result.current.manipulationBindings.onPointerUp?.(event(c, 50, 50)));
    expect(begin).toHaveBeenCalled();
    expect(update).toHaveBeenCalled();
  });
  it('restores drag-start transform on cancel', () => {
    const c = setup();
    const update = vi.fn();
    const h = renderHook(() =>
      useSketchManipulation({
        canvasRef: { current: c },
        overlayRef: { current: null },
        activeTool: 'move',
        disabled: false,
        selection: null,
        floating: meta,
        beginFloatingSelection: vi.fn(),
        updateFloatingTransform: update,
      })
    );
    act(() => h.result.current.manipulationBindings.onPointerDown?.(event(c, 30, 30)));
    act(() => h.result.current.manipulationBindings.onPointerCancel?.(event(c, 50, 50)));
    expect(update).toHaveBeenLastCalledWith(meta.transform);
  });
});
