/**
 * Material-normalisation tests.
 *
 * Synthetic documents keep every decision explainable: the pixel fixtures say
 * exactly which blue values are metal, and the assertions read the output
 * texture back through sharp to prove green (roughness) is untouched.
 */

import { Document } from '@gltf-transform/core';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { analyseDocument } from './asset-analysis.js';
import { normaliseMaterials } from './material-normalise.js';

/** Encode raw RGBA pixels as a lossless PNG. */
async function png(pixels: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const bytes = await sharp(Buffer.from(pixels), {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();
  return new Uint8Array(bytes);
}

/** Decode a texture's RGBA pixels. */
async function decode(image: Uint8Array): Promise<Uint8Array> {
  const { data } = await sharp(Buffer.from(image))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new Uint8Array(data);
}

/** A doc with one material using a metallic-roughness texture. */
async function docWithTexture(materialName: string, image: Uint8Array): Promise<Document> {
  const doc = new Document();
  const texture = doc.createTexture('metallic-roughness').setImage(image).setMimeType('image/png');
  doc.createMaterial(materialName).setMetallicRoughnessTexture(texture);
  return doc;
}

describe('normaliseMaterials', () => {
  it('makes a material with no metal texels non-metal and keeps its texture', async () => {
    const doc = await docWithTexture('wood', await png(new Uint8Array([0, 128, 0, 255]), 1, 1));
    const analysis = await analyseDocument(doc);

    const decisions = await normaliseMaterials(doc, analysis);

    expect(doc.getRoot().listMaterials()[0]?.getMetallicFactor()).toBe(0);
    expect(decisions[0]).toMatchObject({
      index: 0,
      name: 'wood',
      decision: 'non-metal',
      metalFraction: 0,
    });
  });

  it('keeps metal and masks the weak blue values without changing green', async () => {
    const image = await png(
      new Uint8Array([
        0,
        50,
        255,
        255,
        0,
        200,
        40,
        255, // blue 255 (metal), then blue 40 (weak)
      ]),
      2,
      1
    );
    const doc = await docWithTexture('barrel', image);
    const analysis = await analyseDocument(doc);

    const decisions = await normaliseMaterials(doc, analysis);

    expect(doc.getRoot().listMaterials()[0]?.getMetallicFactor()).toBe(1);
    expect(decisions[0]).toMatchObject({
      decision: 'metal-masked',
      metalFraction: 0.5,
      maskedFraction: 0.5,
    });

    const output = await decode(
      doc.getRoot().listMaterials()[0]?.getMetallicRoughnessTexture()?.getImage() ??
        new Uint8Array()
    );
    expect(output[2]).toBeGreaterThanOrEqual(250);
    expect(output[6]).toBe(0);
    expect(output[1]).toBe(50);
    expect(output[5]).toBe(200);
  });

  it('sets an untextured factor of 1 to non-metal and leaves an explicit factor alone', async () => {
    const doc = new Document();
    const implicit = doc.createMaterial('implicit');
    const explicit = doc.createMaterial('explicit').setMetallicFactor(0.4);
    const analysis = await analyseDocument(doc);

    const decisions = await normaliseMaterials(doc, analysis);

    expect(implicit.getMetallicFactor()).toBe(0);
    expect(explicit.getMetallicFactor()).toBe(0.4);
    expect(decisions).toMatchObject([
      { index: 0, name: 'implicit', decision: 'non-metal', metalFraction: 0 },
      { index: 1, name: 'explicit', decision: 'unchanged', reason: 'explicit-factor' },
    ]);
  });

  it('clones a shared texture instead of editing it in place', async () => {
    const originalImage = await png(new Uint8Array([0, 0, 255, 255]), 1, 1);
    const doc = new Document();
    const texture = doc.createTexture('shared').setImage(originalImage).setMimeType('image/png');
    const first = doc.createMaterial('first').setMetallicRoughnessTexture(texture);
    const second = doc.createMaterial('second').setMetallicRoughnessTexture(texture);
    const analysis = await analyseDocument(doc);

    const decisions = await normaliseMaterials(doc, analysis);

    expect(decisions.map((decision) => decision.decision)).toEqual([
      'metal-masked',
      'metal-masked',
    ]);
    expect(texture.getImage()).toEqual(originalImage);
    expect(first.getMetallicRoughnessTexture()).not.toBe(texture);
    expect(second.getMetallicRoughnessTexture()).not.toBe(texture);
    expect(first.getMetallicRoughnessTexture()).not.toBe(second.getMetallicRoughnessTexture());
  });
});
