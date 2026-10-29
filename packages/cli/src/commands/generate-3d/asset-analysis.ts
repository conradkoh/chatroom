/**
 * Generate 3D — geometry bounds and material statistics for a master GLB.
 *
 * This module is pure analysis: it reads a parsed glTF-Transform `Document` and
 * returns numbers. It never writes files, never fetches anything, and never
 * mutates the document. Later slices use these numbers to decide whether the
 * master's metal, roughness, or scene bounds need correcting.
 *
 * The material statistic of interest lives in the metallic-roughness texture:
 * glTF packs metalness in the blue channel and roughness in the green channel.
 * Both are 8-bit data in the masters fal returns, so a 256-bin histogram gives
 * exact percentiles without sorting the decoded pixels.
 *
 * `@gltf-transform/functions` and `sharp` are imported inside `analyseDocument`
 * for the same reason `web-variant.ts` does it: importing either eagerly makes a
 * command that never analyses a mesh pay for the texture decoder.
 */

import type { Document, Material, Texture } from '@gltf-transform/core';
import type sharp from 'sharp';

/** One decoded channel's distribution, normalised to 0..1. */
export interface ChannelStats {
  /** Mean of the channel, 0..1. */
  mean: number;
  p5: number;
  p50: number;
  p95: number;
  /** Fraction of texels with value >= 0.5. */
  fractionAtLeastHalf: number;
  /** Fraction of texels with value <= 0.1. */
  fractionAtMostTenth: number;
}

/** One material's factors plus its metallic-roughness texture channels. */
export interface MaterialStats {
  index: number;
  name: string | null;
  metallicFactor: number;
  roughnessFactor: number;
  /** True when the material has a metallicRoughnessTexture. */
  hasMetallicRoughnessTexture: boolean;
  /** Blue channel (metal). Null when there is no texture. */
  metal: ChannelStats | null;
  /** Green channel (roughness). Null when there is no texture. */
  roughness: ChannelStats | null;
}

/** Scene bounds and every material's statistics. */
export interface AssetAnalysis {
  bounds: { min: [number, number, number]; max: [number, number, number] };
  extents: [number, number, number];
  materials: MaterialStats[];
}

/** Raw pixels are decoded as RGBA, so channel `c` sits at `4 * texel + c`. */
const CHANNELS_PER_TEXEL = 4;

/**
 * 8-bit thresholds used by the fractions.
 *
 * `128 / 255` is 0.50196, which is the closest byte to one half, and `25 / 255`
 * is 0.09804, the closest byte at or below one tenth. Using the bytes directly
 * keeps the histogram exact instead of re-deriving a threshold per texel.
 */
const HALF_BYTE = 128;
const TENTH_BYTE = 25;

/** 256 histogram bins, one per possible 8-bit channel value. */
const HISTOGRAM_BINS = 256;

/** A zero-valued stat block, used for an empty pixel buffer. */
const EMPTY_STATS: ChannelStats = {
  mean: 0,
  p5: 0,
  p50: 0,
  p95: 0,
  fractionAtLeastHalf: 0,
  fractionAtMostTenth: 0,
};

/** The sharp factory the caller imported dynamically. */
type SharpFactory = typeof sharp;

/** One scene's AABB, as returned by glTF-Transform's `getBounds`. */
interface SceneBounds {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

/** Normalise a byte histogram value to the 0..1 channel range. */
function toUnit(value: number): number {
  return value / 255;
}

/**
 * Nearest-rank percentile from a byte histogram.
 *
 * `fraction * total` is rounded up, so p50 of an even count lands on the upper
 * middle value (the conventional nearest-rank definition).
 */
function percentile(histogram: Uint32Array, total: number, fraction: number): number {
  const target = Math.min(total, Math.ceil(fraction * total));
  let seen = 0;
  for (let value = 0; value < HISTOGRAM_BINS; value += 1) {
    seen += histogram[value] ?? 0;
    if (seen >= target) return toUnit(value);
  }
  return 1;
}

/** Sum the histogram bins in an inclusive byte range. */
function countInRange(histogram: Uint32Array, first: number, last: number): number {
  let count = 0;
  for (let value = first; value <= last; value += 1) count += histogram[value] ?? 0;
  return count;
}

/**
 * Channel statistics from raw 8-bit RGBA pixels; exported for unit tests.
 *
 * The buffer must be RGBA (`sharp(...).ensureAlpha().raw()`), so every fourth
 * byte belongs to the requested channel.
 */
// fallow-ignore-next-line unused-export
export function channelStats(
  pixels: Uint8Array | Uint8ClampedArray,
  channel: 0 | 1 | 2
): ChannelStats {
  const total = Math.floor(pixels.length / CHANNELS_PER_TEXEL);
  if (total === 0) return EMPTY_STATS;

  const histogram = new Uint32Array(HISTOGRAM_BINS);
  let weighted = 0;
  for (let index = channel; index < pixels.length; index += CHANNELS_PER_TEXEL) {
    const value = pixels[index];
    histogram[value] += 1;
    weighted += value;
  }

  return {
    mean: weighted / (255 * total),
    p5: percentile(histogram, total, 0.05),
    p50: percentile(histogram, total, 0.5),
    p95: percentile(histogram, total, 0.95),
    fractionAtLeastHalf: countInRange(histogram, HALF_BYTE, HISTOGRAM_BINS - 1) / total,
    fractionAtMostTenth: countInRange(histogram, 0, TENTH_BYTE) / total,
  };
}

/** True when all six bounds components are finite numbers. */
function isFiniteBox(min: readonly number[], max: readonly number[]): boolean {
  return (
    min.every((value) => Number.isFinite(value)) && max.every((value) => Number.isFinite(value))
  );
}

/** Merge scene AABBs into one; a document with no finite bounds reports zeros. */
function mergeBounds(boxes: readonly SceneBounds[]): AssetAnalysis['bounds'] {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    min[0] = Math.min(min[0], box.min[0]);
    min[1] = Math.min(min[1], box.min[1]);
    min[2] = Math.min(min[2], box.min[2]);
    max[0] = Math.max(max[0], box.max[0]);
    max[1] = Math.max(max[1], box.max[1]);
    max[2] = Math.max(max[2], box.max[2]);
  }
  return isFiniteBox(min, max) ? { min, max } : { min: [0, 0, 0], max: [0, 0, 0] };
}

/** Axis-aligned sizes that `getBounds` reports as `max - min`. */
function extentsOf(bounds: AssetAnalysis['bounds']): [number, number, number] {
  return [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ];
}

/**
 * Decode one metallic-roughness texture to RGBA pixels.
 *
 * `ensureAlpha()` makes the stride four whatever the source channel count is
 * (JPEG metallic-roughness maps are usually RGB), so `channelStats` can index a
 * fixed stride. A texture shared by two materials is decoded once.
 */
async function decodePixels(
  texture: Texture,
  sharp: SharpFactory,
  cache: Map<Texture, Uint8Array>
): Promise<Uint8Array> {
  const cached = cache.get(texture);
  if (cached !== undefined) return cached;

  const image = texture.getImage();
  if (image === null || image.length === 0) {
    throw new Error('A metallic-roughness texture has no embedded image.');
  }
  const { data } = await sharp(Buffer.from(image))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = new Uint8Array(data);
  cache.set(texture, pixels);
  return pixels;
}

/** One material: its factors and, when present, its texture channel stats. */
async function describeMaterial(
  index: number,
  material: Material,
  sharp: SharpFactory,
  cache: Map<Texture, Uint8Array>
): Promise<MaterialStats> {
  const texture = material.getMetallicRoughnessTexture();
  const base = {
    index,
    name: material.getName() || null,
    metallicFactor: material.getMetallicFactor(),
    roughnessFactor: material.getRoughnessFactor(),
    hasMetallicRoughnessTexture: texture !== null,
  };
  if (texture === null) return { ...base, metal: null, roughness: null };

  const pixels = await decodePixels(texture, sharp, cache);
  return { ...base, metal: channelStats(pixels, 2), roughness: channelStats(pixels, 1) };
}

/**
 * Analyse scene bounds (via `getBounds`) and every material's
 * metallic-roughness texture.
 *
 * The document is read, never written: no transforms run and no property is
 * changed. Throws only when a referenced texture has no embedded image or the
 * decoder cannot read it.
 */
export async function analyseDocument(doc: Document): Promise<AssetAnalysis> {
  const [{ getBounds }, { default: sharp }] = await Promise.all([
    import('@gltf-transform/functions'),
    import('sharp'),
  ]);

  const bounds = mergeBounds(
    doc
      .getRoot()
      .listScenes()
      .map((scene) => getBounds(scene))
  );
  const cache = new Map<Texture, Uint8Array>();
  const materials: MaterialStats[] = [];
  for (const [index, material] of doc.getRoot().listMaterials().entries()) {
    materials.push(await describeMaterial(index, material, sharp, cache));
  }

  return { bounds, extents: extentsOf(bounds), materials };
}
