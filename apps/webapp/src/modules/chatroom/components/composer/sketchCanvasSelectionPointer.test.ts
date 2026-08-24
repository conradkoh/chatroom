import { describe, expect, it, vi } from 'vitest';

import {
  endSelectionPointer,
  mapPointerToSelectionDraft,
  resolveSelectionFinish,
  shouldStartSketchSelection,
} from './sketchCanvasSelectionPointer';
import { SKETCH_CANVAS_HEIGHT, SKETCH_CANVAS_WIDTH } from './sketchConstants';

function canvas() {
  const el = document.createElement('canvas');
  el.width = SKETCH_CANVAS_WIDTH;
  el.height = SKETCH_CANVAS_HEIGHT;
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
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
  return el;
}

describe('sketch selection pointer helpers', () => {
  it('guards selection starts', () => {
    expect(shouldStartSketchSelection(false, true, true, 0, false)).toBe(true);
    expect(shouldStartSketchSelection(true, true, true, 0, false)).toBe(false);
    expect(shouldStartSketchSelection(false, false, true, 0, false)).toBe(false);
    expect(shouldStartSketchSelection(false, true, false, 0, false)).toBe(false);
    expect(shouldStartSketchSelection(false, true, true, 2, false)).toBe(false);
    expect(shouldStartSketchSelection(false, true, true, 0, true)).toBe(false);
  });

  it('maps pointer movement into a normalized draft rectangle', () => {
    const el = canvas();
    const draft = mapPointerToSelectionDraft(el, { x: 300, y: 300 }, 300, 250);
    expect(draft).toEqual({ x: 300, y: 300, width: 600, height: 450 });
  });

  it('commits usable drafts and restores prior selection on cancel', () => {
    const el = canvas();
    const prior = { x: 10, y: 10, width: 100, height: 100 };
    const draft = { x: 0, y: 0, width: 120, height: 90 };
    expect(resolveSelectionFinish(false, el, draft, prior)).toEqual({
      type: 'commit',
      selection: draft,
    });
    expect(resolveSelectionFinish(true, el, null, prior)).toEqual({
      type: 'restore',
      selection: prior,
    });
    expect(resolveSelectionFinish(false, el, { x: 0, y: 0, width: 1, height: 1 }, prior)).toEqual({
      type: 'clear',
    });
  });

  it('releases pointer capture when ending selection', () => {
    const el = canvas();
    const release = vi.fn();
    Object.defineProperties(el, {
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: release },
    });
    endSelectionPointer(el, 3);
    expect(release).toHaveBeenCalledWith(3);
  });
});
