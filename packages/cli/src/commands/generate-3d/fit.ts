/**
 * Generate 3D — fit an asset to the game board.
 *
 * Two optional operations, applied to the scene roots:
 *
 * - `feet` puts the bottom centre at the origin; `center` puts the bounding-box
 *   centre there; `as-is` leaves the origin untouched.
 * - `targetHeight` uniformly scales the model so its vertical extent is the
 *   requested number of metres.
 *
 * The origin step runs first, then the scale, so a `feet` model keeps its feet
 * at the origin instead of floating or sinking as it grows. Root translation is
 * scaled with the root's scale: a uniform scale about the scene origin must move
 * a translated root as well, otherwise the centred pivot drifts.
 *
 * Only root node transforms change. Skins stay valid because inverse bind
 * matrices are local to the skeleton, and animation channels are unaffected.
 * The document is read for bounds and mutated in place; there is no I/O.
 */

import type { Document, Node, Scene, Transform } from '@gltf-transform/core';

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
  /** Uniform scale applied to the scene root nodes. 1 when no scale. */
  scale: number;
  /** Bounds after the fit, recomputed from the document. */
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

type Bounds = FitResult['bounds'];

/** Every distinct node that is a direct child of a scene. */
function sceneRoots(scenes: readonly Scene[]): Node[] {
  const roots = new Set<Node>();
  for (const scene of scenes) {
    for (const child of scene.listChildren()) roots.add(child);
  }
  return [...roots];
}

/**
 * Scale one scene root about the scene origin.
 *
 * Both the local scale and the translation are multiplied, because a root that
 * was translated to centre the model must move with the scale; otherwise the
 * bottom-centre pivot drifts away from the origin.
 */
function scaleRoot(node: Node, scale: number): void {
  const [sx, sy, sz] = node.getScale();
  node.setScale([sx * scale, sy * scale, sz * scale]);
  const [tx, ty, tz] = node.getTranslation();
  node.setTranslation([tx * scale, ty * scale, tz * scale]);
}

/** Recompute bounds from the current document. */
async function currentBounds(
  doc: Document,
  getBounds: (node: Scene) => SceneBounds
): Promise<Bounds> {
  return mergeBounds(
    doc
      .getRoot()
      .listScenes()
      .map((scene) => getBounds(scene))
  );
}

/** The dynamic `getBounds`, narrowed to the scene call this module makes. */
type GetBounds = (node: Scene) => SceneBounds;

/** Move the scene roots so the requested pivot is at the origin. */
async function applyOrigin(
  doc: Document,
  origin: OriginMode,
  center: (options: { pivot: 'center' | 'below' }) => Transform
): Promise<void> {
  if (origin === 'as-is') return;
  await doc.transform(center({ pivot: origin === 'feet' ? 'below' : 'center' }));
}

/** The uniform scale for a target height, refusing a zero-height scene. */
function scaleForHeight(bounds: Bounds, targetHeight: number): number {
  const height = bounds.max[1] - bounds.min[1];
  if (!Number.isFinite(height) || height <= 0) {
    throw new Error('Cannot fit the model: its scene height is 0.');
  }
  return targetHeight / height;
}

/** Scale the roots when a target height is set, then report the new bounds. */
async function scaleToHeight(
  doc: Document,
  targetHeight: number | undefined,
  getBounds: GetBounds
): Promise<{ scale: number; bounds: Bounds }> {
  const bounds = await currentBounds(doc, getBounds);
  if (targetHeight === undefined) return { scale: 1, bounds };

  const scale = scaleForHeight(bounds, targetHeight);
  for (const root of sceneRoots(doc.getRoot().listScenes())) scaleRoot(root, scale);
  return { scale, bounds: await currentBounds(doc, getBounds) };
}

/**
 * Apply origin then scale to the scene roots. Mutates `doc`.
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
    return { origin: 'as-is', targetHeight: null, scale: 1, bounds: analysis.bounds };
  }

  const { center, getBounds } = await import('@gltf-transform/functions');
  await applyOrigin(doc, options.origin, center);
  const scaled = await scaleToHeight(doc, options.targetHeight, getBounds);

  return {
    origin: options.origin,
    targetHeight: options.targetHeight ?? null,
    scale: scaled.scale,
    bounds: {
      min: [scaled.bounds.min[0], scaled.bounds.min[1], scaled.bounds.min[2]],
      max: [scaled.bounds.max[0], scaled.bounds.max[1], scaled.bounds.max[2]],
    },
  };
}
