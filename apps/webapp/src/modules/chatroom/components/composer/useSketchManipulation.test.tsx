import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, type Mock } from 'vitest';

import type { SketchTransform } from './sketchDocument';
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
const event = (c: HTMLCanvasElement, x: number, y: number, modifiers: Partial<PointerEvent> = {}) =>
  ({
    currentTarget: c,
    target: c,
    isPrimary: true,
    button: 0,
    pointerId: 1,
    clientX: x,
    clientY: y,
    shiftKey: false,
    nativeEvent: new PointerEvent('pointermove'),
    ...modifiers,
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

describe('useSketchManipulation transform scaling', () => {
  type Update = Mock<(t: SketchTransform) => void>;
  function renderTransform(update: Update) {
    const c = setup();
    const h = renderHook(() =>
      useSketchManipulation({
        canvasRef: { current: c },
        overlayRef: { current: null },
        activeTool: 'transform',
        disabled: false,
        selection: null,
        floating: meta,
        beginFloatingSelection: vi.fn(),
        updateFloatingTransform: update,
      })
    );
    return { c, h };
  }
  const lastUpdate = (update: Update) =>
    update.mock.calls.at(-1)?.[0] as { scaleX: number; scaleY: number };

  it('scales a corner proportionally by default and freely with Shift', () => {
    const update = vi.fn<(t: SketchTransform) => void>();
    const { c, h } = renderTransform(update);
    act(() => h.result.current.manipulationBindings.onPointerDown?.(event(c, 120, 120)));
    act(() => h.result.current.manipulationBindings.onPointerMove?.(event(c, 170, 130)));
    expect(lastUpdate(update)).toMatchObject({ scaleX: 1.5, scaleY: 1.5 });
    act(() =>
      h.result.current.manipulationBindings.onPointerMove?.(event(c, 170, 130, { shiftKey: true }))
    );
    expect(lastUpdate(update)).toMatchObject({ scaleX: 1.5, scaleY: 1.1 });
  });

  it('scales an edge proportionally by default and along its axis with Shift', () => {
    const update = vi.fn<(t: SketchTransform) => void>();
    const { c, h } = renderTransform(update);
    act(() => h.result.current.manipulationBindings.onPointerDown?.(event(c, 120, 70)));
    act(() => h.result.current.manipulationBindings.onPointerMove?.(event(c, 170, 70)));
    expect(lastUpdate(update)).toMatchObject({ scaleX: 1.5, scaleY: 1.5 });
    act(() =>
      h.result.current.manipulationBindings.onPointerMove?.(event(c, 170, 70, { shiftKey: true }))
    );
    expect(lastUpdate(update)).toMatchObject({ scaleX: 1.5, scaleY: 1 });
  });

  it('recomputes from the drag-start transform when Shift is toggled mid-drag', () => {
    const update = vi.fn<(t: SketchTransform) => void>();
    const { c, h } = renderTransform(update);
    act(() => h.result.current.manipulationBindings.onPointerDown?.(event(c, 120, 120)));
    act(() => h.result.current.manipulationBindings.onPointerMove?.(event(c, 130, 130)));
    expect(lastUpdate(update)).toMatchObject({ scaleX: 1.1, scaleY: 1.1 });
    act(() =>
      h.result.current.manipulationBindings.onPointerMove?.(event(c, 170, 130, { shiftKey: true }))
    );
    expect(lastUpdate(update)).toMatchObject({ scaleX: 1.5, scaleY: 1.1 });
  });
});
