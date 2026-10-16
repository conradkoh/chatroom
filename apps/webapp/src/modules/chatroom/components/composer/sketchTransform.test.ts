import { describe, expect, it } from 'vitest';

import type { SketchTransform } from './sketchDocument';
import {
  computeContainTransform,
  getTransformedCorners,
  hitTestTransformHandle,
  clampTransformToCanvas,
  translateTransform,
  scaleTransformFromHandle,
  rotateTransformFromHandle,
  resolveSketchScaleAspectMode,
  type SketchTransformHandle,
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
    expect(next.x).toBe(0);
    expect(next.y).toBe(-15);
  });

  it('ignores off-axis drag on an edge', () => {
    const next = scale(base, 'east', { x: 0, y: 30 }, { x: 0, y: 0 });
    expect(next.scaleX).toBe(1);
    expect(next.scaleY).toBe(1);
    expect(next.x).toBe(0);
    expect(next.y).toBe(0);
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
    expect(next.x).toBe(0);
    expect(next.y).toBe(0);
  });

  it('enlarges instead of shrinking when dragging north-west outward', () => {
    const next = scale(base, 'north-west', { x: -10, y: -10 }, { x: 0, y: 0 });
    expect(next.scaleX).toBe(2);
    expect(next.scaleY).toBe(2);
    // SE corner stays at (10, 10).
    expect(next.x).toBe(-10);
    expect(next.y).toBe(-10);
  });

  it('clamps both scales to 0.01 at minimum', () => {
    const next = scale(base, 'south-east', { x: -100, y: -100 }, { x: 0, y: 0 });
    expect(next.scaleX).toBe(0.01);
    expect(next.scaleY).toBe(0.01);
    expect(next.x).toBe(0);
    expect(next.y).toBe(0);
  });

  it('leaves the free branch unchanged', () => {
    const next = scale(base, 'east', { x: 30, y: 0 }, { x: 0, y: 0 }, false);
    expect(next.scaleX).toBe(4);
    expect(next.scaleY).toBe(1);
    expect(next.x).toBe(0);
    expect(next.y).toBe(0);
  });
});

describe('scaleTransformFromHandle anchors the opposite handle', () => {
  const pointAt = (t: SketchTransform, w: number, h: number, fx: number, fy: number) => {
    const c = Math.cos(t.rotationRadians);
    const s = Math.sin(t.rotationRadians);
    return {
      x: t.x + c * (fx * w * t.scaleX) - s * (fy * h * t.scaleY),
      y: t.y + s * (fx * w * t.scaleX) + c * (fy * h * t.scaleY),
    };
  };
  const handleFraction = (handle: SketchTransformHandle) => ({
    fx: handle.includes('west') ? 0 : handle.includes('east') ? 1 : 0.5,
    fy: handle.includes('north') ? 0 : handle.includes('south') ? 1 : 0.5,
  });
  const outwardDelta = (handle: SketchTransformHandle) => ({
    x: handle.includes('east') ? 20 : handle.includes('west') ? -20 : 0,
    y: handle.includes('south') ? 20 : handle.includes('north') ? -20 : 0,
  });
  const HANDLES: readonly SketchTransformHandle[] = [
    'north-east',
    'north-west',
    'south-east',
    'south-west',
    'north',
    'south',
    'east',
    'west',
  ];
  const base: SketchTransform = { x: 300, y: 200, scaleX: 1, scaleY: 1, rotationRadians: 0 };
  const w = 100;
  const h = 50;

  for (const preserveAspect of [true, false]) {
    for (const rotationRadians of [0, 0.4]) {
      it(`keeps the opposite handle fixed (${preserveAspect ? 'proportional' : 'free'}, θ=${rotationRadians})`, () => {
        const t: SketchTransform = { ...base, rotationRadians };
        for (const handle of HANDLES) {
          const { fx, fy } = handleFraction(handle);
          const delta = outwardDelta(handle);
          const start = pointAt(t, w, h, fx, fy);
          const pointer = { x: start.x + delta.x, y: start.y + delta.y };
          const result = scaleTransformFromHandle(t, handle, pointer, start, w, h, preserveAspect);
          const before = pointAt(t, w, h, 1 - fx, 1 - fy);
          const after = pointAt(result, w, h, 1 - fx, 1 - fy);
          expect(after.x).toBeCloseTo(before.x, 6);
          expect(after.y).toBeCloseTo(before.y, 6);
        }
      });
    }
  }

  it('matches the reported NE case with the SW corner fixed', () => {
    const t: SketchTransform = { x: 20, y: 20, scaleX: 1, scaleY: 1, rotationRadians: 0 };
    const result = scaleTransformFromHandle(
      t,
      'north-east',
      { x: 170, y: 20 },
      { x: 120, y: 20 },
      100,
      100,
      true
    );
    expect(result.scaleX).toBe(1.5);
    expect(result.scaleY).toBe(1.5);
    expect(result.x).toBe(20);
    expect(result.y).toBe(-30);
    const sw = pointAt(result, 100, 100, 0, 1);
    expect(sw.x).toBeCloseTo(20, 6);
    expect(sw.y).toBeCloseTo(120, 6);
  });
});
