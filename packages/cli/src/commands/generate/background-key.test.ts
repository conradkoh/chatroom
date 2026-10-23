/**
 * Background-key tests.
 *
 * Synthetic RGBA images exercise the border median, flood fill, speck filter,
 * edge feather, and deterministic output without touching disk or pngjs.
 */

import { describe, expect, it } from 'vitest';

import {
  BORDER_NOISE_REFUSAL_RATIO,
  DEFAULT_MIN_AREA_PERCENT,
  DEFAULT_TOLERANCE,
  keyBackground,
  type KeyResult,
} from './background-key.js';

interface TestImage {
  width: number;
  height: number;
  data: Uint8Array;
}

const BG: [number, number, number, number] = [210, 210, 210, 255];

function makeImage(width: number, height: number, background = BG): TestImage {
  const data = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) data.set(background, offset);
  return { width, height, data };
}

function setPixel(
  image: TestImage,
  x: number,
  y: number,
  colour: [number, number, number, number]
): void {
  image.data.set(colour, (y * image.width + x) * 4);
}

function alphaAt(image: TestImage, x: number, y: number): number {
  return image.data[(y * image.width + x) * 4 + 3] ?? 0;
}

function key(
  image: TestImage,
  overrides: Partial<Parameters<typeof keyBackground>[1]> = {}
): KeyResult {
  return keyBackground(image, {
    tolerance: DEFAULT_TOLERANCE,
    minAreaPercent: DEFAULT_MIN_AREA_PERCENT,
    allowEdgeContent: false,
    ...overrides,
  });
}

function expectOk(result: KeyResult): Extract<KeyResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected keying to succeed, got: ${result.message}`);
  return result;
}

/** Deterministic background jitter so the tests never flake. */
function jitterBackground(image: TestImage, amplitude: number, base = 210): void {
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const jitter = ((x * 37 + y * 101) % (amplitude * 2 + 1)) - amplitude;
      setPixel(image, x, y, [base + jitter, base + jitter, base + jitter, 255]);
    }
  }
}

function fillCircle(
  image: TestImage,
  centreX: number,
  centreY: number,
  radius: number,
  colour: [number, number, number, number]
): void {
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const dx = x - centreX;
      const dy = y - centreY;
      if (dx * dx + dy * dy <= radius * radius) setPixel(image, x, y, colour);
    }
  }
}

function fillRect(
  image: TestImage,
  x0: number,
  y0: number,
  width: number,
  height: number,
  colour: [number, number, number, number]
): void {
  for (let y = y0; y < y0 + height; y += 1) {
    for (let x = x0; x < x0 + width; x += 1) setPixel(image, x, y, colour);
  }
}

/** Flat ±5 background with a disc and a 2px anti-aliased rim. */
function discImage(): TestImage {
  const image = makeImage(161, 161);
  jitterBackground(image, 5);
  const centre = 80;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const distance = Math.hypot(x - centre, y - centre);
      if (distance <= 55) setPixel(image, x, y, [200, 30, 30, 255]);
      else if (distance <= 57) setPixel(image, x, y, [205, 120, 120, 255]);
    }
  }
  return image;
}

describe('keyBackground', () => {
  it('keys a disc on a jittered background and feathers only its rim', () => {
    const image = discImage();
    const result = expectOk(key(image));

    expect(result.components).toBe(1);
    expect(result.background[0]).toBeCloseTo(210, -1);
    expect(result.background[1]).toBeCloseTo(210, -1);
    expect(result.background[2]).toBeCloseTo(210, -1);
    expect(alphaAt({ ...image, data: result.data }, 0, 0)).toBe(0);
    expect(alphaAt({ ...image, data: result.data }, 80, 80)).toBe(255);
    expect(result.regions[0]).toMatchObject({ area: expect.any(Number) });

    const inward: number[] = [];
    for (let x = 0; x <= 80; x += 1) inward.push(alphaAt({ ...image, data: result.data }, x, 80));
    for (let index = 1; index < inward.length; index += 1) {
      expect(inward[index]).toBeGreaterThanOrEqual(inward[index - 1] ?? 0);
    }
  });

  it('drops specks below the minimum area and counts them', () => {
    const image = makeImage(120, 120);
    jitterBackground(image, 18);
    fillCircle(image, 60, 60, 30, [30, 60, 200, 255]);
    const specks: [number, number, number][] = [
      [5, 5, 1],
      [15, 5, 2],
      [25, 5, 3],
      [40, 5, 4],
      [55, 5, 5],
      [75, 5, 6],
      [95, 5, 7],
    ];
    let expectedPixels = 0;
    for (const [x, y, size] of specks) {
      fillRect(image, x, y, size, size, [20, 200, 60, 255]);
      expectedPixels += size * size;
    }

    const result = expectOk(key(image));

    expect(result.components).toBe(1);
    expect(result.droppedSpecks).toEqual({ count: specks.length, pixels: expectedPixels });
  });

  it('keeps an enclosed background-coloured hole opaque', () => {
    const image = makeImage(121, 121);
    fillCircle(image, 60, 60, 40, [200, 40, 40, 255]);
    fillCircle(image, 60, 60, 15, BG);

    const result = expectOk(key(image));

    expect(result.components).toBe(1);
    expect(result.enclosedBackgroundLike).toBeGreaterThan(0);
    expect(alphaAt({ ...image, data: result.data }, 60, 60)).toBe(255);
  });

  it('keeps two separated blobs as two regions and unions their box', () => {
    const image = makeImage(100, 60);
    fillCircle(image, 25, 30, 10, [200, 40, 40, 255]);
    fillCircle(image, 75, 30, 10, [30, 60, 200, 255]);

    const result = expectOk(key(image));

    expect(result.components).toBe(2);
    expect(result.regions).toHaveLength(2);
    expect(result.contentBox).toEqual({ x: 15, y: 20, width: 71, height: 21 });
  });

  it('refuses artwork touching the border unless allowEdgeContent is set', () => {
    const image = makeImage(50, 50);
    fillRect(image, 0, 0, 50, 1, [200, 40, 40, 255]);
    fillRect(image, 20, 20, 10, 10, [200, 40, 40, 255]);

    const refused = key(image);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).toContain('of the tile border differs');

    const allowed = expectOk(key(image, { allowEdgeContent: true }));
    expect(allowed.components).toBeGreaterThanOrEqual(1);
  });

  it('refuses an all-background tile', () => {
    const result = key(makeImage(30, 30));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('no foreground found');
  });

  it('refuses a fully transparent border', () => {
    const image = makeImage(10, 10, [0, 0, 0, 0]);

    const result = key(image);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe('tile border is fully transparent');
  });

  it('keeps the foreground area stable across tolerances', () => {
    const image = discImage();
    const reference = expectOk(key(image, { tolerance: 24 }));

    for (const tolerance of [12, 24, 40]) {
      const result = expectOk(key(image, { tolerance }));
      const difference = Math.abs(result.foregroundPixels - reference.foregroundPixels);
      expect(difference / reference.foregroundPixels).toBeLessThan(0.02);
    }
  });

  it('is byte-deterministic', () => {
    const image = discImage();

    const first = expectOk(key(image));
    const second = expectOk(key(image));

    expect(Array.from(first.data)).toEqual(Array.from(second.data));
  });

  it('reports half-pixel centre offsets exactly', () => {
    const image = makeImage(20, 10);
    fillRect(image, 8, 3, 4, 3, [200, 40, 40, 255]);

    const result = expectOk(key(image));

    expect(result.contentBox).toEqual({ x: 8, y: 3, width: 4, height: 3 });
    expect(result.centerOffset).toEqual({ x: 0, y: -0.5 });
  });

  it('exposes the documented defaults and refusal ratio', () => {
    expect(DEFAULT_TOLERANCE).toBe(24);
    expect(DEFAULT_MIN_AREA_PERCENT).toBe(0.5);
    expect(BORDER_NOISE_REFUSAL_RATIO).toBe(0.02);
  });
});
