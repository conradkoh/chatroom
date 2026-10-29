/**
 * Fit tests.
 *
 * Synthetic documents make the expected numbers exact: a unit box has height 1,
 * so a 0.75 m target must scale by 0.75 and put its bottom at 0. The byte-level
 * as-is test proves the default path does not touch the document.
 */

import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { describe, expect, it } from 'vitest';

import { analyseDocument } from './asset-analysis.js';
import { applyFit } from './fit.js';

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
  const primitive = doc.createPrimitive().setAttribute('POSITION', positions).setIndices(indices);
  const mesh = doc.createMesh('box').addPrimitive(primitive);
  doc.createScene('scene').addChild(doc.createNode('box-node').setMesh(mesh));
  return doc;
}

/** A flat triangle at y = 0, so its scene height is zero. */
function createFlatDocument(): Document {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const positions = doc
    .createAccessor('positions')
    .setType('VEC3')
    .setArray(new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, 0, 0, 0.5]))
    .setBuffer(buffer);
  const primitive = doc.createPrimitive().setAttribute('POSITION', positions);
  const mesh = doc.createMesh('plane').addPrimitive(primitive);
  doc.createScene('scene').addChild(doc.createNode('plane-node').setMesh(mesh));
  return doc;
}

/** A small skinned triangle: one joint and one inverse bind matrix. */
function createSkinnedDocument(): Document {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const positions = doc
    .createAccessor('positions')
    .setType('VEC3')
    .setArray(new Float32Array([-0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0, 0.5, 0.5]))
    .setBuffer(buffer);
  const joints = doc
    .createAccessor('joints')
    .setType('VEC4')
    .setArray(new Uint16Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))
    .setBuffer(buffer);
  const weights = doc
    .createAccessor('weights')
    .setType('VEC4')
    .setArray(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]))
    .setBuffer(buffer);
  const inverseBindMatrices = doc
    .createAccessor('inverse-bind')
    .setType('MAT4')
    .setArray(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]))
    .setBuffer(buffer);
  const joint = doc.createNode('joint');
  const skin = doc
    .createSkin('skin')
    .addJoint(joint)
    .setInverseBindMatrices(inverseBindMatrices)
    .setSkeleton(joint);
  const primitive = doc
    .createPrimitive()
    .setAttribute('POSITION', positions)
    .setAttribute('JOINTS_0', joints)
    .setAttribute('WEIGHTS_0', weights);
  const mesh = doc.createMesh('skinned-mesh').addPrimitive(primitive);
  const node = doc.createNode('skinned-node').setMesh(mesh).setSkin(skin);
  node.addChild(joint);
  doc.createScene('scene').addChild(node);
  return doc;
}

/** The midpoint of one axis of a bounds pair. */
function midpoint(min: number, max: number): number {
  return (min + max) / 2;
}

describe('applyFit', () => {
  it('puts the feet at the origin and scales the unit box to 0.75 m', async () => {
    const doc = createBoxDocument();
    const analysis = await analyseDocument(doc);

    const result = await applyFit(doc, analysis, { origin: 'feet', targetHeight: 0.75 });

    expect(result.scale).toBeCloseTo(0.75, 10);
    expect(result.bounds.min[1]).toBeCloseTo(0, 10);
    expect(result.bounds.max[1]).toBeCloseTo(0.75, 10);
    expect(midpoint(result.bounds.min[0], result.bounds.max[0])).toBeCloseTo(0, 10);
    expect(midpoint(result.bounds.min[2], result.bounds.max[2])).toBeCloseTo(0, 10);
  });

  it('centres the model on the origin without scaling when no height is given', async () => {
    const doc = createBoxDocument();
    const analysis = await analyseDocument(doc);

    const result = await applyFit(doc, analysis, { origin: 'center' });

    expect(result.scale).toBe(1);
    expect(midpoint(result.bounds.min[0], result.bounds.max[0])).toBeCloseTo(0, 10);
    expect(midpoint(result.bounds.min[1], result.bounds.max[1])).toBeCloseTo(0, 10);
    expect(midpoint(result.bounds.min[2], result.bounds.max[2])).toBeCloseTo(0, 10);
  });

  it('does not change the document for as-is with no height', async () => {
    const doc = createBoxDocument();
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const before = await io.writeBinary(doc);
    const analysis = await analyseDocument(doc);

    const result = await applyFit(doc, analysis, { origin: 'as-is' });

    expect(await io.writeBinary(doc)).toEqual(before);
    expect(result).toEqual({
      origin: 'as-is',
      targetHeight: null,
      scale: 1,
      bounds: analysis.bounds,
    });
  });

  it('throws when a target height is requested for a flat document', async () => {
    const doc = createFlatDocument();
    const analysis = await analyseDocument(doc);

    await expect(applyFit(doc, analysis, { origin: 'as-is', targetHeight: 0.75 })).rejects.toThrow(
      /scene height is 0/
    );
  });

  it('keeps the skin joints and inverse bind matrices when scaling', async () => {
    const doc = createSkinnedDocument();
    const analysis = await analyseDocument(doc);
    const skin = doc.getRoot().listSkins()[0];
    const jointCount = skin?.listJoints().length ?? 0;
    const matrixCount = skin?.getInverseBindMatrices()?.getCount() ?? 0;

    await applyFit(doc, analysis, { origin: 'feet', targetHeight: 0.75 });

    expect(skin?.listJoints()).toHaveLength(jointCount);
    expect(skin?.getInverseBindMatrices()?.getCount()).toBe(matrixCount);
    expect(jointCount).toBe(1);
    expect(matrixCount).toBe(1);
  });
});
