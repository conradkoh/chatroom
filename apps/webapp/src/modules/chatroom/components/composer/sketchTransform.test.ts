import { describe, expect, it } from 'vitest';

import {
  computeContainTransform,
  getTransformedCorners,
  hitTestTransformHandle,
  clampTransformToCanvas,
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
});
