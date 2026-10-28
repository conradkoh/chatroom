/**
 * Web variant tests.
 *
 * These build small GLBs in memory, so the optimizer runs for real (including
 * `sharp`) without any network, fixture file, or fal call. They pin the numbers
 * the package manifest depends on — triangle count, whether simplify ran, the
 * texture format and size — plus the two input features the transform has to
 * respect: alpha and primitive modes.
 */

import { Document, NodeIO, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { createWebVariant, type WebVariantOptions } from './web-variant.js';

const OPTIONS: WebVariantOptions = { triangleTarget: 30_000, maxTexturePx: 1024, quality: 80 };

function glbIo(): NodeIO {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS);
}

interface BuildGlbOptions {
  positions: Float32Array;
  indices?: Uint32Array | undefined;
  /** Base-colour texture bytes and MIME type. */
  texture?: { bytes: Uint8Array; mimeType: string } | undefined;
  alphaMode?: 'OPAQUE' | 'BLEND' | undefined;
  /** glTF primitive mode; defaults to TRIANGLES. */
  mode?: ReturnType<Primitive['getMode']> | undefined;
}

/** One mesh, one primitive, an optional material, written as a real GLB. */
async function buildGlb(opts: BuildGlbOptions): Promise<Uint8Array> {
  const document = new Document();
  const buffer = document.createBuffer();
  // Copy into fresh typed arrays: accessors require `ArrayBuffer`-backed views.
  const position = document
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array(opts.positions))
    .setBuffer(buffer);
  const primitive = document.createPrimitive().setAttribute('POSITION', position);
  if (opts.indices !== undefined) {
    const indices = document
      .createAccessor()
      .setType('SCALAR')
      .setArray(new Uint32Array(opts.indices))
      .setBuffer(buffer);
    primitive.setIndices(indices);
  }
  if (opts.mode !== undefined) primitive.setMode(opts.mode);
  if (opts.texture !== undefined) {
    const texture = document
      .createTexture('base')
      .setImage(opts.texture.bytes)
      .setMimeType(opts.texture.mimeType);
    const material = document
      .createMaterial('mat')
      .setBaseColorTexture(texture)
      .setAlphaMode(opts.alphaMode ?? 'OPAQUE');
    primitive.setMaterial(material);
  }
  const mesh = document.createMesh().addPrimitive(primitive);
  document.createScene().addChild(document.createNode().setMesh(mesh));
  return glbIo().writeBinary(document);
}

/** `count` disjoint triangles: 3 unique vertices each, `count * 3` indices. */
function disjointTriangles(count: number): { positions: Float32Array; indices: Uint32Array } {
  const positions = new Float32Array(count * 9);
  const indices = new Uint32Array(count * 3);
  for (let triangle = 0; triangle < count; triangle += 1) {
    const base = triangle * 3;
    // Each triangle sits one unit to the right of the previous one.
    positions.set([triangle, 0, 0, triangle + 1, 0, 0, triangle, 0, 1], triangle * 9);
    indices.set([base, base + 1, base + 2], triangle * 3);
  }
  return { positions, indices };
}

/** A `squares` x `squares` coplanar grid: two triangles per cell. */
function grid(squares: number): { positions: Float32Array; indices: Uint32Array } {
  const side = squares + 1;
  const positions = new Float32Array(side * side * 3);
  for (let row = 0; row < side; row += 1) {
    for (let column = 0; column < side; column += 1) {
      const index = (row * side + column) * 3;
      positions.set([column, 0, row], index);
    }
  }
  const indices = new Uint32Array(squares * squares * 6);
  let cursor = 0;
  for (let row = 0; row < squares; row += 1) {
    for (let column = 0; column < squares; column += 1) {
      const topLeft = row * side + column;
      indices.set(
        [topLeft, topLeft + 1, topLeft + side, topLeft + 1, topLeft + side + 1, topLeft + side],
        cursor
      );
      cursor += 6;
    }
  }
  return { positions, indices };
}

/**
 * A 2048x2048 PNG with varied pixels, so sharp has something to re-encode.
 *
 * It must not be a single flat colour: `prune()` drops solid textures, which
 * would make the texture assertions test that optimisation instead of the
 * encoder.
 */
async function pngTexture(): Promise<Uint8Array> {
  const side = 2048;
  const pixels = Buffer.alloc(side * side * 4);
  for (let index = 0; index < side * side; index += 1) {
    pixels[index * 4] = (index * 7) % 256;
    pixels[index * 4 + 1] = (index * 13) % 256;
    pixels[index * 4 + 2] = (index * 29) % 256;
    pixels[index * 4 + 3] = 255;
  }
  const bytes = await sharp(pixels, { raw: { width: side, height: side, channels: 4 } })
    .png()
    .toBuffer();
  return new Uint8Array(bytes);
}

/** Rebuild a GLB with extra `extensionsUsed`, keeping every chunk length valid. */
function withExtensionsUsed(glb: Uint8Array, extensions: string[]): Uint8Array {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength))) as Record<
    string,
    unknown
  >;
  json['extensionsUsed'] = extensions;
  const chunk = new TextEncoder().encode(JSON.stringify(json));
  const padded = new Uint8Array(Math.ceil(chunk.length / 4) * 4).fill(0x20);
  padded.set(chunk);
  // Keep the BIN chunk (and its header) exactly as it was.
  const rest = glb.subarray(20 + jsonLength);
  const total = 20 + padded.length + rest.length;
  const out = new Uint8Array(total);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, 0x46546c67, true); // 'glTF'
  outView.setUint32(4, 2, true);
  outView.setUint32(8, total, true);
  outView.setUint32(12, padded.length, true);
  outView.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(padded, 20);
  out.set(rest, 20 + padded.length);
  return out;
}

describe('createWebVariant', () => {
  it('counts triangles and skips simplify when under target', async () => {
    const glb = await buildGlb(disjointTriangles(2));

    const variant = await createWebVariant(glb, OPTIONS);

    expect(variant.triangles).toBe(2);
    expect(variant.simplified).toBe(false);
    expect(variant.textures).toEqual([]);
    expect(variant.extensionsUsed).toEqual([]);
  });

  it('writes a readable GLB that keeps the glTF magic', async () => {
    const glb = await buildGlb(disjointTriangles(2));

    const variant = await createWebVariant(glb, OPTIONS);

    expect(Buffer.from(variant.bytes).subarray(0, 4).toString('latin1')).toBe('glTF');
    const reread = await glbIo().readBinary(variant.bytes);
    expect(reread.getRoot().listMeshes()).toHaveLength(1);
  });

  it('counts a non-indexed primitive by its position count', async () => {
    // Six vertices, no indices: two triangles.
    const glb = await buildGlb({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 2, 0, 0, 3, 0, 0, 2, 0, 1]),
    });

    const variant = await createWebVariant(glb, OPTIONS);

    expect(variant.triangles).toBe(2);
  });

  it('ignores strip and fan primitives, which do not divide by three', async () => {
    const strip = await buildGlb({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1]),
      mode: Primitive.Mode.TRIANGLE_STRIP,
    });
    const triangles = await buildGlb(disjointTriangles(2));

    expect((await createWebVariant(strip, OPTIONS)).triangles).toBe(0);
    expect((await createWebVariant(triangles, OPTIONS)).triangles).toBe(2);
  });

  it('simplifies toward the target and gets within a small margin', async () => {
    const glb = await buildGlb(grid(10)); // 200 triangles
    const sourceTriangles = 200;

    const variant = await createWebVariant(glb, { ...OPTIONS, triangleTarget: 50 });

    expect(variant.simplified).toBe(true);
    // Best effort: the target is approached, not guaranteed exactly.
    expect(variant.triangles).toBeLessThanOrEqual(60);
    expect(variant.triangles).toBeGreaterThan(0);
    expect(variant.triangles).toBeLessThan(sourceTriangles * 0.5);
  });

  it('reports simplified when disjoint geometry cannot reach the target', async () => {
    // Separate triangles share no edge, so simplify can only drop whole
    // components; the target is unreachable but the attempt still happened.
    const glb = await buildGlb(disjointTriangles(40));

    const variant = await createWebVariant(glb, { ...OPTIONS, triangleTarget: 10 });

    expect(variant.simplified).toBe(true);
    expect(variant.triangles).toBeLessThanOrEqual(120);
  });

  it('re-encodes an opaque base-colour texture as JPEG at the pixel cap', async () => {
    const glb = await buildGlb({
      ...disjointTriangles(2),
      texture: { bytes: await pngTexture(), mimeType: 'image/png' },
    });

    const variant = await createWebVariant(glb, { ...OPTIONS, maxTexturePx: 1024 });

    expect(variant.textures).toHaveLength(1);
    expect(variant.textures[0]?.mimeType).toBe('image/jpeg');
    expect(Math.max(variant.textures[0]?.width ?? 0, variant.textures[0]?.height ?? 0)).toBe(1024);
    expect(variant.textures[0]?.width).toBe(1024);

    // The texture survives serialisation, still as JPEG.
    const reread = await glbIo().readBinary(variant.bytes);
    expect(reread.getRoot().listTextures()[0]?.getMimeType()).toBe('image/jpeg');
  });

  it('keeps a texture PNG when a blending material relies on its alpha', async () => {
    const glb = await buildGlb({
      ...disjointTriangles(2),
      texture: { bytes: await pngTexture(), mimeType: 'image/png' },
      alphaMode: 'BLEND',
    });

    const variant = await createWebVariant(glb, { ...OPTIONS, maxTexturePx: 1024 });

    expect(variant.textures[0]?.mimeType).toBe('image/png');
    expect(variant.textures[0]?.width).toBe(1024);
  });

  it('adds no extensions even when it re-encodes textures', async () => {
    const glb = await buildGlb({
      ...disjointTriangles(4),
      texture: { bytes: await pngTexture(), mimeType: 'image/png' },
    });

    const variant = await createWebVariant(glb, { ...OPTIONS, maxTexturePx: 256, quality: 60 });

    expect(variant.extensionsUsed).toEqual([]);
  });

  it('refuses a Draco-compressed master with an error naming the extension', async () => {
    const glb = withExtensionsUsed(await buildGlb(disjointTriangles(2)), [
      'KHR_draco_mesh_compression',
    ]);

    await expect(createWebVariant(glb, OPTIONS)).rejects.toThrow(
      /KHR_draco_mesh_compression.*cannot decode/
    );
  });

  it('loads a master that declares other extensions', async () => {
    const glb = withExtensionsUsed(await buildGlb(disjointTriangles(2)), ['KHR_materials_unlit']);

    const variant = await createWebVariant(glb, OPTIONS);

    expect(variant.triangles).toBe(2);
  });
});
