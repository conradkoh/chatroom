import { describe, expect, it } from 'vitest';

import {
  computeContainTransform,
  getTransformedCorners,
  hitTestTransformHandle,
  clampTransformToCanvas,
  translateTransform,
  scaleTransformFromHandle,
  rotateTransformFromHandle,
  resolveSketchScaleAspectMode,
} from './sketchTransform';

describe('sketchTransform', () => {
  it('contains without upscaling and centers', () => {
    expect(computeContainTransform(600, 300)).toEqual({
      x: 300,
      y: 300,
      scaleX: 1,
      scaleY: 1,
      rotationRadians: 0,
    });
    expect(computeContainTransform(2000, 1000).scaleX).toBeLessThan(1);
  });
  it('computes corners and corner hit tests', () => {
    const t = { x: 10, y: 20, scaleX: 2, scaleY: 2, rotationRadians: 0 };
    expect(getTransformedCorners(t, 5, 10)[2]).toEqual({ x: 20, y: 40 });
    expect(hitTestTransformHandle({ x: 10, y: 20 }, t, 5, 10, 1)).toBe('north-west');
  });
  it('keeps transformed bounds partially visible', () => {
    expect(
      clampTransformToCanvas(
        { x: -1000, y: -1000, scaleX: 1, scaleY: 1, rotationRadians: 0 },
        20,
        20
      ).x
    ).toBe(-4);
  });
  it('translates, scales, and rotates', () => {
    const t = { x: 10, y: 20, scaleX: 1, scaleY: 1, rotationRadians: 0 };
    expect(translateTransform(t, 5, -3)).toEqual({ ...t, x: 15, y: 17 });
    const c = scaleTransformFromHandle(
      t,
      'south-east',
      { x: 20, y: 20 },
      { x: 0, y: 0 },
      10,
      10,
      true
    );
    expect(c.scaleX).toBeCloseTo(c.scaleY);
    const e = scaleTransformFromHandle(t, 'east', { x: 30, y: 0 }, { x: 0, y: 0 }, 10, 10, false);
    expect(e.scaleX).toBeGreaterThan(1);
    expect(e.scaleY).toBe(1);
    expect(
      rotateTransformFromHandle(t, { x: 10, y: 0 }, { x: 0, y: 0 }, 10, 10).rotationRadians
    ).not.toBe(0);
  });
});

describe('resolveSketchScaleAspectMode', () => {
  it('is proportional without Shift and free with Shift', () => {
    expect(resolveSketchScaleAspectMode({ shiftKey: false })).toBe('proportional');
    expect(resolveSketchScaleAspectMode({ shiftKey: true })).toBe('free');
  });
});

describe('scaleTransformFromHandle proportional mode', () => {
  const base = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotationRadians: 0 };
  const scale = (
    t: typeof base,
    handle: Parameters<typeof scaleTransformFromHandle>[1],
    pointer: { x: number; y: number },
    start: { x: number; y: number },
    preserveAspect = true
  ) => scaleTransformFromHandle(t, handle, pointer, start, 10, 10, preserveAspect);

  it('scales an east edge uniformly from the drag-start ratio', () => {
    const next = scale(base, 'east', { x: 30, y: 0 }, { x: 0, y: 0 });
    expect(next.scaleX).toBe(4);
    expect(next.scaleY).toBe(4);
  });

  it('ignores off-axis drag on an edge', () => {
    const next = scale(base, 'east', { x: 0, y: 30 }, { x: 0, y: 0 });
    expect(next.scaleX).toBe(1);
    expect(next.scaleY).toBe(1);
  });

  it('preserves a non-square ratio when scaling a corner', () => {
    const next = scale(
      { ...base, scaleX: 2, scaleY: 1 },
      'south-east',
      { x: 10, y: 0 },
      { x: 0, y: 0 }
    );
    expect(next.scaleX).toBe(3);
    expect(next.scaleY).toBe(1.5);
  });

  it('enlarges instead of shrinking when dragging north-west outward', () => {
    const next = scale(base, 'north-west', { x: -10, y: -10 }, { x: 0, y: 0 });
    expect(next.scaleX).toBe(2);
    expect(next.scaleY).toBe(2);
  });

  it('clamps both scales to 0.01 at minimum', () => {
    const next = scale(base, 'south-east', { x: -100, y: -100 }, { x: 0, y: 0 });
    expect(next.scaleX).toBe(0.01);
    expect(next.scaleY).toBe(0.01);
  });

  it('leaves the free branch unchanged', () => {
    const next = scale(base, 'east', { x: 30, y: 0 }, { x: 0, y: 0 }, false);
    expect(next.scaleX).toBe(4);
    expect(next.scaleY).toBe(1);
  });
});
