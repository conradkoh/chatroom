import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FULL_SKETCH_SELECTION } from './sketchCanvasSelection';
import { SKETCH_CANVAS_HEIGHT, SKETCH_CANVAS_WIDTH } from './sketchConstants';
import { useSketchSelection } from './useSketchSelection';

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
  Object.defineProperties(canvas, {
    setPointerCapture: { value: vi.fn() },
    releasePointerCapture: { value: vi.fn() },
    hasPointerCapture: { value: vi.fn(() => true) },
  });
  return canvas;
}

function pointerProps(type: string, canvas: HTMLCanvasElement, init: PointerEventInit = {}) {
  const nativeEvent = new PointerEvent(type, {
    bubbles: true,
    isPrimary: true,
    pointerId: 1,
    button: 0,
    clientX: 100,
    clientY: 100,
    ...init,
  });
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

describe('useSketchSelection', () => {
  it('finalizes a usable drag into selection state', () => {
    const canvas = setupCanvas();
    const onRequestDelete = vi.fn();
    const { result } = renderHook(() =>
      useSketchSelection({
        canvasRef: { current: canvas },
        enabled: true,
        disabled: false,
        onRequestDelete,
      })
    );
    act(() => {
      result.current.selectionBindings.onPointerDown?.(
        pointerProps('pointerdown', canvas) as never
      );
      result.current.selectionBindings.onPointerMove?.(
        pointerProps('pointermove', canvas, { clientX: 300, clientY: 250 }) as never
      );
      result.current.selectionBindings.onPointerUp?.(pointerProps('pointerup', canvas) as never);
    });
    expect(result.current.selection).toEqual({ x: 300, y: 300, width: 600, height: 450 });
  });

  it('clears unusable drags and restores prior selection on cancel', () => {
    const canvas = setupCanvas();
    const onRequestDelete = vi.fn();
    const { result } = renderHook(() =>
      useSketchSelection({
        canvasRef: { current: canvas },
        enabled: true,
        disabled: false,
        onRequestDelete,
      })
    );
    act(() => {
      result.current.selectionBindings.onPointerDown?.(
        pointerProps('pointerdown', canvas) as never
      );
      result.current.selectionBindings.onPointerMove?.(
        pointerProps('pointermove', canvas, { clientX: 300, clientY: 250 }) as never
      );
      result.current.selectionBindings.onPointerUp?.(pointerProps('pointerup', canvas) as never);
    });
    const prior = result.current.selection;
    act(() => {
      result.current.selectionBindings.onPointerDown?.(
        pointerProps('pointerdown', canvas, { pointerId: 2 }) as never
      );
      result.current.selectionBindings.onPointerCancel?.(
        pointerProps('pointercancel', canvas, { pointerId: 2 }) as never
      );
    });
    expect(result.current.selection).toEqual(prior);
  });

  it('requests delete and clears on Escape', () => {
    const canvas = setupCanvas();
    const onRequestDelete = vi.fn();
    const { result } = renderHook(() =>
      useSketchSelection({
        canvasRef: { current: canvas },
        enabled: true,
        disabled: false,
        onRequestDelete,
      })
    );
    act(() => {
      result.current.selectionBindings.onPointerDown?.(
        pointerProps('pointerdown', canvas) as never
      );
      result.current.selectionBindings.onPointerMove?.(
        pointerProps('pointermove', canvas, { clientX: 300, clientY: 250 }) as never
      );
      result.current.selectionBindings.onPointerUp?.(pointerProps('pointerup', canvas) as never);
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    });
    expect(onRequestDelete).toHaveBeenCalled();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(result.current.selection).toBeNull();
  });

  it('clears when disabled and ignores select-all keyboard action', () => {
    const canvas = setupCanvas();
    const onRequestDelete = vi.fn();
    const { result, rerender } = renderHook(
      (props: { enabled: boolean }) =>
        useSketchSelection({
          canvasRef: { current: canvas },
          enabled: props.enabled,
          disabled: false,
          onRequestDelete,
        }),
      { initialProps: { enabled: true } }
    );
    act(() => {
      result.current.selectionBindings.onPointerDown?.(
        pointerProps('pointerdown', canvas) as never
      );
      result.current.selectionBindings.onPointerMove?.(
        pointerProps('pointermove', canvas, { clientX: 300, clientY: 250 }) as never
      );
      result.current.selectionBindings.onPointerUp?.(pointerProps('pointerup', canvas) as never);
    });
    rerender({ enabled: false });
    expect(result.current.selection).toBeNull();
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true })
      );
    });
    expect(result.current.selection).toBeNull();
  });

  it('selects the full canvas on Cmd+A and Ctrl+A', () => {
    const canvas = setupCanvas();
    const onRequestDelete = vi.fn();
    const { result } = renderHook(() =>
      useSketchSelection({
        canvasRef: { current: canvas },
        enabled: true,
        disabled: false,
        onRequestDelete,
      })
    );
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true })
      );
    });
    expect(result.current.selection).toEqual(FULL_SKETCH_SELECTION);
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true })
      );
    });
    expect(result.current.selection).toEqual(FULL_SKETCH_SELECTION);
  });

  it('ignores select-all when the hook is disabled', () => {
    const canvas = setupCanvas();
    const { result } = renderHook(() =>
      useSketchSelection({
        canvasRef: { current: canvas },
        enabled: true,
        disabled: true,
        onRequestDelete: vi.fn(),
      })
    );
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true })
      );
    });
    expect(result.current.selection).toBeNull();
  });
});
