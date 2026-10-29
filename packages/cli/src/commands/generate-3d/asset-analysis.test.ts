/**
 * Asset-analysis tests.
 *
 * The fixtures are synthetic documents, so every number is explainable without a
 * real GLB. The end-to-end numbers from the assessment packages are checked
 * separately when the slice is verified.
 */

import { Document } from '@gltf-transform/core';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { analyseDocument, channelStats } from './asset-analysis.js';

/** A 2×2 RGBA image: two texels with blue 0 and two with blue 255. */
const BLUE_QUARTERS = new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255]);

/** A unit cube from -0.5 to 0.5 on every axis, centred on the origin. */
function createBoxDocument(): Document {
  const doc = new Document();
  const buffer = doc.createBuffer();

  const positions = doc
    .createAccessor('positions')
    .setType('VEC3')
    .setArray(
      new Float32Array([
        -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5,
        -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
      ])
    )
    .setBuffer(buffer);

  const indices = doc
    .createAccessor('indices')
    .setType('SCALAR')
    .setArray(
      new Uint16Array([
        4, 5, 6, 4, 6, 7, 1, 0, 3, 1, 3, 2, 0, 4, 7, 0, 7, 3, 5, 1, 2, 5, 2, 6, 3, 7, 6, 3, 6, 2, 0,
        1, 5, 0, 5, 4,
      ])
    )
    .setBuffer(buffer);

  const material = doc.createMaterial('box-material');
  const primitive = doc
    .createPrimitive()
    .setAttribute('POSITION', positions)
    .setIndices(indices)
    .setMaterial(material);
  const mesh = doc.createMesh('box').addPrimitive(primitive);
  const node = doc.createNode('box-node').setMesh(mesh);
  doc.createScene('scene').addChild(node);

  return doc;
}

describe('channelStats', () => {
  it('summarises a channel with mean, percentiles, and half/tenth fractions', () => {
    const stats = channelStats(BLUE_QUARTERS, 2);

    expect(stats.fractionAtLeastHalf).toBe(0.5);
    expect(stats.fractionAtMostTenth).toBe(0.5);
    expect(stats.mean).toBe(0.5);
    expect(stats.p5).toBe(0);
    expect(stats.p50).toBe(0);
    expect(stats.p95).toBe(1);
  });

  it('returns zeroed statistics for an empty buffer', () => {
    expect(channelStats(new Uint8Array(), 2)).toEqual({
      mean: 0,
      p5: 0,
      p50: 0,
      p95: 0,
      fractionAtLeastHalf: 0,
      fractionAtMostTenth: 0,
    });
  });
});

describe('analyseDocument', () => {
  it('reports the bounds and extents of a unit box centred on the origin', async () => {
    const analysis = await analyseDocument(createBoxDocument());

    expect(analysis.bounds.min).toEqual([-0.5, -0.5, -0.5]);
    expect(analysis.bounds.max).toEqual([0.5, 0.5, 0.5]);
    expect(analysis.extents).toEqual([1, 1, 1]);
  });

  it('reports factors and null channels for a material without a texture', async () => {
    const doc = createBoxDocument();
    doc.getRoot().listMaterials()[0]?.setMetallicFactor(0.25).setRoughnessFactor(0.75);

    const [material] = (await analyseDocument(doc)).materials;

    expect(material).toMatchObject({
      index: 0,
      name: 'box-material',
      metallicFactor: 0.25,
      roughnessFactor: 0.75,
      hasMetallicRoughnessTexture: false,
      metal: null,
      roughness: null,
    });
  });

  it('reports metal 1 when every metallic-roughness texel has blue 255', async () => {
    const doc = new Document();
    const png = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: { r: 0, g: 0, b: 255 },
      },
    })
      .png()
      .toBuffer();
    const texture = doc
      .createTexture('metallic-roughness')
      .setImage(new Uint8Array(png))
      .setMimeType('image/png');
    doc
      .createMaterial('painted')
      .setMetallicFactor(1)
      .setRoughnessFactor(1)
      .setMetallicRoughnessTexture(texture);

    const [material] = (await analyseDocument(doc)).materials;

    expect(material?.hasMetallicRoughnessTexture).toBe(true);
    expect(material?.metal?.fractionAtLeastHalf).toBe(1);
    expect(material?.metal?.mean).toBe(1);
    expect(material?.roughness?.fractionAtMostTenth).toBe(1);
  });
});
