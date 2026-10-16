import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, type Mock } from 'vitest';

import type { SketchTransform } from './sketchDocument';
import { cursorForSketchManipulation, useSketchManipulation } from './useSketchManipulation';

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
    update.mock.calls.at(-1)?.[0] as { x: number; y: number; scaleX: number; scaleY: number };

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
    expect(lastUpdate(update)).toMatchObject({ scaleX: 1.5, scaleY: 1.5, x: 20, y: -5 });
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

describe('useSketchManipulation cursor', () => {
  const renderManip = (overrides: Partial<Parameters<typeof useSketchManipulation>[0]> = {}) => {
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
        updateFloatingTransform: vi.fn(),
        ...overrides,
      })
    );
    return { c, h };
  };
  const hover = (
    { c, h }: ReturnType<typeof renderManip>,
    x: number,
    y: number
  ): string | undefined => {
    act(() => h.result.current.manipulationBindings.onPointerMove?.(event(c, x, y)));
    return h.result.current.cursor;
  };

  it('maps each transform handle to its resize cursor on hover', () => {
    const rendered = renderManip();
    expect(hover(rendered, 20, 20)).toBe('nwse-resize');
    expect(hover(rendered, 120, 20)).toBe('nesw-resize');
    expect(hover(rendered, 70, 20)).toBe('ns-resize');
    expect(hover(rendered, 120, 70)).toBe('ew-resize');
    expect(hover(rendered, 70, 70)).toBe('move');
    expect(hover(rendered, 500, 500)).toBe('default');
  });

  it('keeps the active handle cursor during a drag and resets on pointer up', () => {
    const { c, h } = renderManip();
    act(() => h.result.current.manipulationBindings.onPointerDown?.(event(c, 20, 20)));
    act(() => h.result.current.manipulationBindings.onPointerMove?.(event(c, 500, 500)));
    expect(h.result.current.cursor).toBe('nwse-resize');
    act(() => h.result.current.manipulationBindings.onPointerUp?.(event(c, 500, 500)));
    expect(h.result.current.cursor).toBe('default');
  });

  it('gives move over a selection and default with nothing for the move tool', () => {
    const withFloating = renderManip({ activeTool: 'move' });
    expect(hover(withFloating, 500, 500)).toBe('move');
    const empty = renderManip({ activeTool: 'move', floating: null, selection: null });
    expect(hover(empty, 500, 500)).toBe('default');
  });

  it('returns undefined when disabled or for non-manipulation tools', () => {
    expect(renderManip({ disabled: true }).h.result.current.cursor).toBeUndefined();
    expect(renderManip({ activeTool: 'brush' }).h.result.current.cursor).toBeUndefined();
    expect(renderManip({ activeTool: 'select' }).h.result.current.cursor).toBeUndefined();
  });
});

describe('cursorForSketchManipulation', () => {
  it.each([
    ['north-west', 'nwse-resize'],
    ['south-east', 'nwse-resize'],
    ['north-east', 'nesw-resize'],
    ['south-west', 'nesw-resize'],
    ['north', 'ns-resize'],
    ['south', 'ns-resize'],
    ['east', 'ew-resize'],
    ['west', 'ew-resize'],
    ['move', 'move'],
  ] as const)('maps %s to %s', (handle, expected) => {
    expect(cursorForSketchManipulation(handle, false)).toBe(expected);
  });

  it('uses grab while idle and grabbing while dragging for rotate', () => {
    expect(cursorForSketchManipulation('rotate', false)).toBe('grab');
    expect(cursorForSketchManipulation('rotate', true)).toBe('grabbing');
  });

  it('defaults when there is no handle', () => {
    expect(cursorForSketchManipulation(null, false)).toBe('default');
  });
});
