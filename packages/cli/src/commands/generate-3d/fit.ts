/**
 * Generate 3D — fit an asset to the game board.
 *
 * Two optional operations, applied through one new wrapper node:
 *
 * - `feet` puts the bottom centre at the origin; `center` puts the bounding-box
 *   centre there; `as-is` leaves the origin untouched.
 * - `targetHeight` uniformly scales the model so its vertical extent is the
 *   requested number of metres.
 *
 * The wrapper becomes the single parent of every existing scene root, so the
 * model's own root transforms and animation channels are never edited. With no
 * requested change (`as-is` and no height) the document is not touched at all.
 *
 * Skins stay valid because inverse bind matrices are local to the skeleton, and
 * the wrapper transform applies to the whole hierarchy. `getBounds` measures the
 * bind-pose vertices (it does not evaluate skinning), which is the right pose for
 * sizing a rigged asset at rest; joint poses and animation clips are not baked
 * into the bounds.
 *
 * The document is read for bounds and mutated in place; there is no I/O.
 */

import type { Document, Scene } from '@gltf-transform/core';

import { mergeBounds, type AssetAnalysis, type SceneBounds } from './asset-analysis.js';

/** Where the model's origin should sit. */
export type OriginMode = 'feet' | 'center' | 'as-is';

export interface FitOptions {
  origin: OriginMode;
  /** Metres. Undefined = do not scale. */
  targetHeight?: number | undefined;
}

export interface FitResult {
  origin: OriginMode;
  targetHeight: number | null;
  /** Uniform scale applied by the wrapper. 1 when no scale. */
  scale: number;
  /** Wrapper translation in scene units, already multiplied by `scale`. */
  translation: [number, number, number];
  /** Bounds after the fit, recomputed from the document. */
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

type Bounds = FitResult['bounds'];

/** The dynamic `getBounds`, narrowed to the scene call this module makes. */
type GetBounds = (node: Scene) => SceneBounds;

/** Recompute bounds from the current document. */
async function currentBounds(doc: Document, getBounds: GetBounds): Promise<Bounds> {
  return mergeBounds(
    doc
      .getRoot()
      .listScenes()
      .map((scene) => getBounds(scene))
  );
}

/** The wrapper translation before scaling: the pre-scale origin offset. */
function originOffset(bounds: Bounds, origin: OriginMode): [number, number, number] {
  if (origin === 'as-is') return [0, 0, 0];
  const midX = (bounds.min[0] + bounds.max[0]) / 2;
  const midZ = (bounds.min[2] + bounds.max[2]) / 2;
  const y = origin === 'feet' ? bounds.min[1] : (bounds.min[1] + bounds.max[1]) / 2;
  return [-midX, -y, -midZ];
}

/** The uniform scale for a target height, refusing a zero-height scene. */
function scaleForHeight(bounds: Bounds, targetHeight: number): number {
  const height = bounds.max[1] - bounds.min[1];
  if (!Number.isFinite(height) || height <= 0) {
    throw new Error('Cannot fit the model: its scene height is 0.');
  }
  return targetHeight / height;
}

/** Add one wrapper per scene and move its existing roots underneath. */
function addWrapper(doc: Document, translation: [number, number, number], scale: number): void {
  for (const scene of doc.getRoot().listScenes()) {
    const roots = [...scene.listChildren()];
    const wrapper = doc
      .createNode('Fit')
      .setTranslation(translation)
      .setScale([scale, scale, scale]);
    for (const root of roots) wrapper.addChild(root);
    scene.addChild(wrapper);
  }
}

/** True when a fit result is the identity and needs no wrapper. */
function isIdentity(fit: Pick<FitResult, 'scale' | 'translation'>): boolean {
  return (
    fit.scale === 1 &&
    fit.translation[0] === 0 &&
    fit.translation[1] === 0 &&
    fit.translation[2] === 0
  );
}

/**
 * Apply an existing fit to another document, for animation clips that must
 * share the rigged GLB's scale and offset.
 */
export function applyFitTransform(doc: Document, fit: FitResult): void {
  if (isIdentity(fit)) return;
  addWrapper(doc, fit.translation, fit.scale);
}

/** The scale and wrapper translation for an origin/height request. */
function fitTransform(
  bounds: Bounds,
  options: FitOptions
): { scale: number; translation: [number, number, number] } {
  const offset = originOffset(bounds, options.origin);
  const scale =
    options.targetHeight === undefined ? 1 : scaleForHeight(bounds, options.targetHeight);
  return {
    scale,
    translation: [offset[0] * scale, offset[1] * scale, offset[2] * scale],
  };
}

/**
 * Apply origin then scale through a wrapper. Mutates `doc`.
 *
 * `analysis` must describe the document before this call. With no requested
 * change (`as-is` and no height) the document is not touched and its existing
 * bounds are returned, so the default path stays byte-identical.
 */
export async function applyFit(
  doc: Document,
  analysis: AssetAnalysis,
  options: FitOptions
): Promise<FitResult> {
  if (options.origin === 'as-is' && options.targetHeight === undefined) {
    return {
      origin: 'as-is',
      targetHeight: null,
      scale: 1,
      translation: [0, 0, 0],
      bounds: analysis.bounds,
    };
  }

  const { scale, translation } = fitTransform(analysis.bounds, options);
  addWrapper(doc, translation, scale);

  const { getBounds } = await import('@gltf-transform/functions');
  const bounds = await currentBounds(doc, getBounds);
  return {
    origin: options.origin,
    targetHeight: options.targetHeight ?? null,
    scale,
    translation,
    bounds: {
      min: [bounds.min[0], bounds.min[1], bounds.min[2]],
      max: [bounds.max[0], bounds.max[1], bounds.max[2]],
    },
  };
}
