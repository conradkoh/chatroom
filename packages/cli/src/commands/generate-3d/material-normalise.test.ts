/**
 * Material-normalisation tests.
 *
 * Synthetic documents keep every decision explainable: the pixel fixtures say
 * exactly which blue values are metal, and the assertions read the output
 * texture back through sharp to prove green (roughness) is untouched.
 */

import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
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
    expect(output[2]).toBe(255);
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

  it('leaves a textured material with explicit factor 0 alone', async () => {
    const image = await png(new Uint8Array([0, 128, 255, 255, 0, 128, 255, 255]), 2, 1);
    const doc = await docWithTexture('explicit-zero', image);
    const material = doc.getRoot().listMaterials()[0];
    material?.setMetallicFactor(0);
    const before = material?.getMetallicRoughnessTexture()?.getImage();
    const analysis = await analyseDocument(doc);

    const decisions = await normaliseMaterials(doc, analysis);

    expect(material?.getMetallicFactor()).toBe(0);
    expect(material?.getMetallicRoughnessTexture()?.getImage()).toEqual(before);
    expect(decisions[0]).toMatchObject({
      index: 0,
      decision: 'unchanged',
      reason: 'explicit-factor',
    });
  });

  it('leaves a textured material with an explicit fractional factor alone', async () => {
    const image = await png(new Uint8Array([0, 128, 255, 255, 0, 128, 255, 255]), 2, 1);
    const doc = await docWithTexture('explicit-fractional', image);
    const material = doc.getRoot().listMaterials()[0];
    material?.setMetallicFactor(0.4);
    const before = material?.getMetallicRoughnessTexture()?.getImage();
    const analysis = await analyseDocument(doc);

    const decisions = await normaliseMaterials(doc, analysis);

    expect(material?.getMetallicFactor()).toBe(0.4);
    expect(material?.getMetallicRoughnessTexture()?.getImage()).toEqual(before);
    expect(decisions[0]).toMatchObject({ decision: 'unchanged', reason: 'explicit-factor' });
  });

  it('masks blue 127 and keeps blue 128 at the threshold', async () => {
    const image = await png(new Uint8Array([0, 128, 127, 255, 0, 128, 128, 255]), 2, 1);
    const doc = await docWithTexture('threshold', image);
    const analysis = await analyseDocument(doc);

    const decisions = await normaliseMaterials(doc, analysis);
    const output = await decode(
      doc.getRoot().listMaterials()[0]?.getMetallicRoughnessTexture()?.getImage() ??
        new Uint8Array()
    );

    expect(output[2]).toBe(0);
    expect(output[6]).toBe(128);
    expect(decisions[0]).toMatchObject({ decision: 'metal-masked', maskedFraction: 0.5 });
  });

  it('counts 26 but not 25 in maskedFraction', async () => {
    const image = await png(
      new Uint8Array([0, 128, 25, 255, 0, 128, 26, 255, 0, 128, 255, 255]),
      3,
      1
    );
    const doc = await docWithTexture('tenth-boundary', image);
    const analysis = await analyseDocument(doc);

    const decisions = await normaliseMaterials(doc, analysis);

    expect(decisions[0]).toMatchObject({
      decision: 'metal-masked',
      maskedFraction: 1 / 3,
    });
  });

  it('treats below 1% metal as non-metal and 1% or more as metal', async () => {
    const build = async (metalTexels: number) => {
      const pixels = new Uint8Array(1000 * 4);
      for (let index = 0; index < 1000; index += 1) {
        pixels[index * 4 + 1] = 128;
        pixels[index * 4 + 2] = index < metalTexels ? 128 : 0;
        pixels[index * 4 + 3] = 255;
      }
      return png(pixels, 1000, 1);
    };

    const below = await docWithTexture('below-one-percent', await build(9));
    const exactly = await docWithTexture('exactly-one-percent', await build(10));
    const above = await docWithTexture('above-one-percent', await build(11));

    expect((await normaliseMaterials(below, await analyseDocument(below)))[0]).toMatchObject({
      decision: 'non-metal',
    });
    expect((await normaliseMaterials(exactly, await analyseDocument(exactly)))[0]).toMatchObject({
      decision: 'metal-masked',
    });
    expect((await normaliseMaterials(above, await analyseDocument(above)))[0]).toMatchObject({
      decision: 'metal-masked',
    });
  });

  it('leaves a texture shared with another material slot untouched', async () => {
    const originalImage = await png(new Uint8Array([0, 128, 255, 255]), 1, 1);
    const doc = new Document();
    const shared = doc.createTexture('shared').setImage(originalImage).setMimeType('image/png');
    const metal = doc.createMaterial('metal').setMetallicRoughnessTexture(shared);
    const colour = doc.createMaterial('colour').setBaseColorTexture(shared);
    const analysis = await analyseDocument(doc);

    const decisions = await normaliseMaterials(doc, analysis);

    expect(decisions[0]).toMatchObject({ decision: 'metal-masked' });
    expect(metal.getMetallicRoughnessTexture()).not.toBe(shared);
    expect(colour.getBaseColorTexture()).toBe(shared);
    expect(shared.getImage()).toEqual(originalImage);
  });

  it('masks a shared texture once and keeps both masked materials on it', async () => {
    const image = await png(new Uint8Array([0, 128, 255, 255, 0, 128, 40, 255]), 2, 1);
    const doc = new Document();
    doc.createBuffer();
    const shared = doc.createTexture('shared').setImage(image).setMimeType('image/png');
    const first = doc.createMaterial('first').setMetallicRoughnessTexture(shared);
    const second = doc.createMaterial('second').setMetallicRoughnessTexture(shared);
    const analysis = await analyseDocument(doc);

    const decisions = await normaliseMaterials(doc, analysis);

    expect(decisions.map((decision) => decision.decision)).toEqual([
      'metal-masked',
      'metal-masked',
    ]);
    expect(first.getMetallicRoughnessTexture()).toBe(shared);
    expect(second.getMetallicRoughnessTexture()).toBe(shared);
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const reread = await io.readBinary(await io.writeBinary(doc));
    const materials = reread.getRoot().listMaterials();
    expect(reread.getRoot().listTextures()).toHaveLength(1);
    expect(materials[0]?.getMetallicRoughnessTexture()).toBe(
      materials[1]?.getMetallicRoughnessTexture()
    );
    const output = await decode(
      materials[0]?.getMetallicRoughnessTexture()?.getImage() ?? new Uint8Array()
    );
    expect(output[2]).toBe(255);
    expect(output[6]).toBe(0);
  });

  it('keeps the original for a non-masked shared user and clones for the masked one', async () => {
    const originalImage = await png(new Uint8Array([0, 128, 255, 255, 0, 128, 40, 255]), 2, 1);
    const doc = new Document();
    const shared = doc.createTexture('shared').setImage(originalImage).setMimeType('image/png');
    const masked = doc.createMaterial('masked').setMetallicRoughnessTexture(shared);
    const explicit = doc
      .createMaterial('explicit')
      .setMetallicRoughnessTexture(shared)
      .setMetallicFactor(0);
    const analysis = await analyseDocument(doc);

    const decisions = await normaliseMaterials(doc, analysis);

    expect(decisions[0]).toMatchObject({ decision: 'metal-masked' });
    expect(decisions[1]).toMatchObject({ decision: 'unchanged', reason: 'explicit-factor' });
    expect(masked.getMetallicRoughnessTexture()).not.toBe(shared);
    expect(explicit.getMetallicRoughnessTexture()).toBe(shared);
    expect(shared.getImage()).toEqual(originalImage);
  });
});
