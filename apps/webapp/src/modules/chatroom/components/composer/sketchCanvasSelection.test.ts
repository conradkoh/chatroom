import { describe, expect, it, vi } from 'vitest';

import {
  drawSketchSelectionMarquee,
  drawSketchTransformOverlay,
  isFullSketchSelection,
  isUsableSketchSelection,
  normalizeSketchSelection,
  resolveSketchSelectionAction,
} from './sketchCanvasSelection';
import { SKETCH_CANVAS_HEIGHT, SKETCH_CANVAS_WIDTH } from './sketchConstants';

const keyEvent = (
  key: string,
  target: EventTarget | null = document.body,
  modifiers: Partial<KeyboardEvent> = {}
) => ({
  key,
  target,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
});

describe('sketch selection geometry', () => {
  it('normalizes reverse drags and clamps endpoints', () => {
    expect(normalizeSketchSelection({ x: 500, y: 400 }, { x: 100, y: 200 })).toEqual({
      x: 100,
      y: 200,
      width: 400,
      height: 200,
    });
    expect(normalizeSketchSelection({ x: -50, y: -50 }, { x: 5000, y: 5000 })).toEqual({
      x: 0,
      y: 0,
      width: SKETCH_CANVAS_WIDTH,
      height: SKETCH_CANVAS_HEIGHT,
    });
  });

  it('accepts selections above the CSS minimum threshold', () => {
    expect(isUsableSketchSelection({ x: 0, y: 0, width: 5, height: 5 }, 3)).toBe(false);
    expect(isUsableSketchSelection({ x: 0, y: 0, width: 6, height: 6 }, 3)).toBe(true);
  });

  it('detects full-canvas selections', () => {
    expect(
      isFullSketchSelection({
        x: 0,
        y: 0,
        width: SKETCH_CANVAS_WIDTH,
        height: SKETCH_CANVAS_HEIGHT,
      })
    ).toBe(true);
    expect(isFullSketchSelection({ x: 1, y: 0, width: 1200, height: 900 })).toBe(false);
  });
});

describe('sketch selection keyboard actions', () => {
  it('resolves select-all, delete, and escape actions', () => {
    expect(
      resolveSketchSelectionAction(keyEvent('a', document.body, { metaKey: true }), false)
    ).toBe('select-all');
    expect(
      resolveSketchSelectionAction(keyEvent('a', document.body, { ctrlKey: true }), false)
    ).toBe('select-all');
    expect(resolveSketchSelectionAction(keyEvent('Delete'), true)).toBe('request-delete');
    expect(resolveSketchSelectionAction(keyEvent('Backspace'), true)).toBe('request-delete');
    expect(resolveSketchSelectionAction(keyEvent('Escape'), true)).toBe('clear');
  });

  it('ignores modified, unselected, and editable targets', () => {
    expect(resolveSketchSelectionAction(keyEvent('Delete'), false)).toBeNull();
    expect(
      resolveSketchSelectionAction(
        keyEvent('a', document.body, { metaKey: true, shiftKey: true }),
        false
      )
    ).toBeNull();
    const input = document.createElement('input');
    expect(resolveSketchSelectionAction(keyEvent('Delete', input), true)).toBeNull();
  });
});

describe('sketch selection marquee', () => {
  it('clears and draws a dashed outline', () => {
    const ctx = {
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      strokeRect: vi.fn(),
      setLineDash: vi.fn(),
      lineDashOffset: 0,
      strokeStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;
    drawSketchSelectionMarquee(ctx, { x: 10, y: 20, width: 100, height: 80 });
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, SKETCH_CANVAS_WIDTH, SKETCH_CANVAS_HEIGHT);
    expect(ctx.strokeRect).toHaveBeenCalled();
    drawSketchSelectionMarquee(ctx, null);
    expect(ctx.clearRect).toHaveBeenCalledTimes(2);
  });
  it('draws a transform overlay', () => {
    const ctx = {
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      strokeRect: vi.fn(),
      fillRect: vi.fn(),
      setLineDash: vi.fn(),
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 1,
    } as unknown as CanvasRenderingContext2D;
    expect(() =>
      drawSketchTransformOverlay(
        ctx,
        { x: 10, y: 10, scaleX: 1, scaleY: 1, rotationRadians: 0 },
        50,
        50,
        'transform'
      )
    ).not.toThrow();
  });
});
