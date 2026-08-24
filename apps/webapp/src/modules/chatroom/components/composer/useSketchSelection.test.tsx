import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FULL_SKETCH_SELECTION } from './sketchCanvasSelection';
import { SKETCH_CANVAS_HEIGHT, SKETCH_CANVAS_WIDTH } from './sketchConstants';
import type { SketchSelection } from './sketchDocument';
import { useSketchSelection } from './useSketchSelection';

const ACTIVE_LAYER_ID = 'layer-test-1';
function setupCanvas() {
  const c = document.createElement('canvas');
  c.width = SKETCH_CANVAS_WIDTH;
  c.height = SKETCH_CANVAS_HEIGHT;
  vi.spyOn(c, 'getBoundingClientRect').mockReturnValue({
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
  Object.defineProperties(c, {
    setPointerCapture: { value: vi.fn() },
    releasePointerCapture: { value: vi.fn() },
    hasPointerCapture: { value: vi.fn(() => true) },
  });
  return c;
}
function event(canvas: HTMLCanvasElement, type: string, init: PointerEventInit = {}) {
  const native = new PointerEvent(type, {
    bubbles: true,
    isPrimary: true,
    pointerId: 1,
    button: 0,
    clientX: 100,
    clientY: 100,
    ...init,
  });
  return {
    nativeEvent: native,
    currentTarget: canvas,
    target: canvas,
    isPrimary: native.isPrimary,
    button: native.button,
    pointerId: native.pointerId,
    clientX: native.clientX,
    clientY: native.clientY,
  };
}
function controlled(initial: SketchSelection | null = null, enabled = true, disabled = false) {
  const canvas = setupCanvas();
  let selection = initial;
  const onSelectionChange = vi.fn((next: SketchSelection | null) => {
    selection = next;
  });
  const onRequestDelete = vi.fn();
  const hook = renderHook(
    (p: { enabled: boolean; disabled: boolean }) =>
      useSketchSelection({
        canvasRef: { current: canvas },
        activeLayerId: ACTIVE_LAYER_ID,
        selection,
        onSelectionChange,
        enabled: p.enabled,
        disabled: p.disabled,
        onRequestDelete,
      }),
    { initialProps: { enabled, disabled } }
  );
  return { ...hook, canvas, onSelectionChange, onRequestDelete, getSelection: () => selection };
}
function drag(api: ReturnType<typeof controlled>) {
  act(() => {
    api.result.current.selectionBindings.onPointerDown?.(event(api.canvas, 'pointerdown') as never);
    api.result.current.selectionBindings.onPointerMove?.(
      event(api.canvas, 'pointermove', { clientX: 300, clientY: 250 }) as never
    );
    api.result.current.selectionBindings.onPointerUp?.(event(api.canvas, 'pointerup') as never);
  });
}
describe('useSketchSelection', () => {
  it('finalizes a usable drag with active layer id', () => {
    const api = controlled();
    drag(api);
    expect(api.onSelectionChange).toHaveBeenLastCalledWith({
      layerId: ACTIVE_LAYER_ID,
      rect: { x: 300, y: 300, width: 600, height: 450 },
    });
  });
  it('restores prior selection on cancel', () => {
    const prior = { layerId: ACTIVE_LAYER_ID, rect: { x: 1, y: 1, width: 20, height: 20 } };
    const api = controlled(prior);
    act(() => {
      api.result.current.selectionBindings.onPointerDown?.(
        event(api.canvas, 'pointerdown') as never
      );
      api.result.current.selectionBindings.onPointerCancel?.(
        event(api.canvas, 'pointercancel') as never
      );
    });
    expect(api.getSelection()).toEqual(prior);
  });
  it('requests delete and clears on Escape', () => {
    const api = controlled({
      layerId: ACTIVE_LAYER_ID,
      rect: { x: 300, y: 300, width: 600, height: 450 },
    });
    act(() =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    );
    expect(api.onRequestDelete).toHaveBeenCalledWith(expect.objectContaining({ width: 600 }));
    act(() =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    );
    expect(api.onSelectionChange).toHaveBeenLastCalledWith(null);
  });
  it('preserves selection when enabled becomes false', () => {
    const api = controlled();
    drag(api);
    api.rerender({ enabled: false, disabled: false });
    expect(api.getSelection()?.rect).toEqual({ x: 300, y: 300, width: 600, height: 450 });
  });
  it('ignores select-all when not enabled', () => {
    const api = controlled(null, false);
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true })
      )
    );
    expect(api.getSelection()).toBeNull();
  });
  it('selects full canvas on Cmd+A and Ctrl+A', () => {
    const api = controlled();
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true })
      )
    );
    expect(api.getSelection()).toEqual({ layerId: ACTIVE_LAYER_ID, rect: FULL_SKETCH_SELECTION });
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true })
      )
    );
    expect(api.getSelection()?.rect).toEqual(FULL_SKETCH_SELECTION);
  });
  it('ignores select-all when disabled', () => {
    const api = controlled(null, true, true);
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true })
      )
    );
    expect(api.getSelection()).toBeNull();
  });
});
