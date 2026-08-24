import { describe, expect, it } from 'vitest';

import {
  computeContainTransform,
  getTransformedCorners,
  hitTestTransformHandle,
  clampTransformToCanvas,
  translateTransform,
  scaleTransformFromHandle,
  rotateTransformFromHandle,
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
