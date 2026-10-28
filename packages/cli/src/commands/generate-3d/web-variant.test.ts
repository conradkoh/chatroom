/**
 * Web variant tests.
 *
 * These build a small GLB in memory, so the optimizer runs for real (including
 * `sharp`) without any network, fixture file, or fal call. The aim is to pin the
 * three properties the package manifest depends on: the triangle count, whether
 * simplify ran, and that no GLB extension was added.
 */

import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { describe, expect, it } from 'vitest';

import { createWebVariant, type WebVariantOptions } from './web-variant.js';

const OPTIONS: WebVariantOptions = { triangleTarget: 30_000, maxTexturePx: 1024, quality: 80 };

function glbIo(): NodeIO {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS);
}

/** A single primitive from a positions/index array pair. */
async function buildGlb(opts: {
  positions: Float32Array;
  indices: Uint16Array | Uint32Array;
}): Promise<Uint8Array> {
  const document = new Document();
  const buffer = document.createBuffer();
  // Copy into fresh typed arrays: accessors require `ArrayBuffer`-backed views.
  const position = document
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array(opts.positions))
    .setBuffer(buffer);
  const indices = document
    .createAccessor()
    .setType('SCALAR')
    .setArray(new Uint32Array(opts.indices))
    .setBuffer(buffer);
  const primitive = document
    .createPrimitive()
    .setAttribute('POSITION', position)
    .setIndices(indices);
  document
    .createScene()
    .addChild(document.createNode().setMesh(document.createMesh().addPrimitive(primitive)));
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

  it('simplifies when the source is over the triangle target', async () => {
    const glb = await buildGlb(grid(10)); // 200 triangles
    const sourceRead = await glbIo().readBinary(glb);
    const sourceTriangles = sourceRead
      .getRoot()
      .listMeshes()
      .flatMap((mesh) => mesh.listPrimitives())
      .reduce((sum, primitive) => sum + (primitive.getIndices()?.getCount() ?? 0) / 3, 0);
    expect(sourceTriangles).toBe(200);

    const variant = await createWebVariant(glb, { ...OPTIONS, triangleTarget: 50 });

    expect(variant.simplified).toBe(true);
    expect(variant.triangles).toBeLessThan(sourceTriangles);
    expect(variant.triangles).toBeGreaterThan(0);
  });

  it('adds no extensions even when it re-encodes textures', async () => {
    const glb = await buildGlb(disjointTriangles(4));

    const variant = await createWebVariant(glb, { ...OPTIONS, maxTexturePx: 256, quality: 60 });

    expect(variant.extensionsUsed).toEqual([]);
  });
});
