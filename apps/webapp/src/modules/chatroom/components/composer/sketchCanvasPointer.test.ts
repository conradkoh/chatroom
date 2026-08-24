import { describe, expect, it, vi } from 'vitest';

import {
  endSketchStroke,
  getCoalescedPointerEvents,
  processCoalescedPointerMove,
  shouldStartSketchStroke,
  type ActiveSketchStroke,
} from './sketchCanvasPointer';

describe('sketch canvas pointer helpers', () => {
  it('guards stroke starts', () => {
    expect(shouldStartSketchStroke(false, true, 0, false)).toBe(true);
    expect(shouldStartSketchStroke(true, true, 0, false)).toBe(false);
    expect(shouldStartSketchStroke(false, false, 0, false)).toBe(false);
    expect(shouldStartSketchStroke(false, true, 2, false)).toBe(false);
    expect(shouldStartSketchStroke(false, true, 0, true)).toBe(false);
  });

  it('falls back when coalesced events are unavailable or empty', () => {
    const event = { getCoalescedEvents: undefined } as unknown as PointerEvent;
    expect(getCoalescedPointerEvents(event)).toEqual([event]);
    const empty = { getCoalescedEvents: () => [] } as unknown as PointerEvent;
    expect(getCoalescedPointerEvents(empty)).toEqual([empty]);
  });

  it('processes mapped coalesced moves and advances the stroke', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 900;
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
    const active: ActiveSketchStroke = {
      pointerId: 1,
      lastPoint: { x: 0, y: 0 },
      brush: { color: '#171717', size: 4 },
    };
    const drawSegment = vi.fn();
    processCoalescedPointerMove(
      canvas,
      [
        { clientX: 100, clientY: 50 },
        { clientX: 200, clientY: 100 },
      ] as PointerEvent[],
      active,
      drawSegment
    );
    expect(drawSegment).toHaveBeenCalledTimes(2);
    expect(active.lastPoint).toEqual({ x: 600, y: 300 });
  });

  it('releases pointer capture when ending a stroke', () => {
    const canvas = document.createElement('canvas');
    const release = vi.fn();
    Object.defineProperties(canvas, {
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: release },
    });
    endSketchStroke(canvas, 7, null);
    expect(release).toHaveBeenCalledWith(7);
  });
});
