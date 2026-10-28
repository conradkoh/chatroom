/**
 * Generate 3D — the web variant of a generated GLB.
 *
 * The master GLB is what fal returned; the web variant is a smaller copy for a
 * browser: welded geometry, optionally simplified toward a triangle target, and
 * textures downscaled to JPEG. JPEG is deliberate — WebP or meshopt compression
 * would add a GLB extension, and the variant must stay loadable by a plain
 * glTF 2.0 viewer.
 *
 * `@gltf-transform/functions` and `sharp` are imported inside the function:
 * `functions` throws at import time when sharp cannot load, so a `generate-3d`
 * run that never builds a package must not pay that cost.
 */

import { NodeIO, type Document, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptSimplifier } from 'meshoptimizer';

export interface WebVariantOptions {
  /** Target triangle count; paired with a 1% error bound, so it is best effort. */
  triangleTarget: number;
  /** Longest texture edge, in pixels. */
  maxTexturePx: number;
  /** JPEG quality for re-encoded textures. */
  quality: number;
}

export interface WebVariantTexture {
  width: number;
  height: number;
  mimeType: string;
}

/** What the package manifest records per GLB. */
export interface GlbStats {
  triangles: number;
  textures: WebVariantTexture[];
  extensionsUsed: string[];
}

export interface WebVariant extends GlbStats {
  bytes: Uint8Array;
  /** True when simplify ran; false when the source was already under target. */
  simplified: boolean;
  /**
   * Stats of the input GLB. Returned here because the source document is already
   * parsed, and the package manifest needs the master's numbers next to the
   * web variant's.
   */
  source: GlbStats;
}

/** glTF-Transform logs every prune/dedup decision to the console by default. */
const SILENT_LOGGER = {
  debug: (): void => {},
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {},
};

/** Triangles in one primitive: indexed count, else the position count, over 3. */
function primitiveTriangles(primitive: Primitive): number {
  const count =
    primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION')?.getCount() ?? 0;
  return count / 3;
}

/** Sum of every primitive's triangle count over every mesh. */
function countTriangles(document: Document): number {
  const total = document
    .getRoot()
    .listMeshes()
    .flatMap((mesh) => mesh.listPrimitives())
    .reduce((sum, primitive) => sum + primitiveTriangles(primitive), 0);
  return Math.round(total);
}

/** Declared GLB extension names, e.g. `KHR_texture_basisu`. */
function knownExtensionNames(document: Document): string[] {
  return document
    .getRoot()
    .listExtensionsUsed()
    .map((extension) => extension.extensionName);
}

/** Size and MIME type of every texture in the document, after the transform. */
function readTextures(document: Document): WebVariantTexture[] {
  return document
    .getRoot()
    .listTextures()
    .map((texture) => {
      // A texture with no image has no size; 0x0 keeps the manifest honest.
      const [width, height] = texture.getSize() ?? [0, 0];
      return { width, height, mimeType: texture.getMimeType() };
    });
}

/**
 * Build the web variant from the master GLB bytes.
 *
 * Throws whatever the optimizer throws (for example a missing `sharp` binary) so
 * the caller can wrap it in a `Generate3dError` and keep the master intact.
 */
export async function createWebVariant(
  glb: Uint8Array,
  opts: WebVariantOptions
): Promise<WebVariant> {
  const [{ weld, simplify, textureCompress, prune, dedup }, { default: sharp }] = await Promise.all(
    [import('@gltf-transform/functions'), import('sharp')]
  );
  await MeshoptSimplifier.ready;

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const document = await io.readBinary(glb);
  // No-op logger: prune() reports every removed property otherwise.
  document.setLogger(SILENT_LOGGER);

  const sourceTriangles = countTriangles(document);
  const shouldSimplify = sourceTriangles > opts.triangleTarget;
  const source: GlbStats = {
    triangles: sourceTriangles,
    textures: readTextures(document),
    extensionsUsed: knownExtensionNames(document),
  };

  const transforms = [
    weld(),
    ...(shouldSimplify
      ? [
          simplify({
            simplifier: MeshoptSimplifier,
            ratio: opts.triangleTarget / sourceTriangles,
            error: 0.01,
            lockBorder: true,
          }),
        ]
      : []),
    textureCompress({
      encoder: sharp,
      targetFormat: 'jpeg',
      resize: [opts.maxTexturePx, opts.maxTexturePx],
      quality: opts.quality,
    }),
    prune(),
    dedup(),
  ];
  await document.transform(...transforms);

  return {
    bytes: await io.writeBinary(document),
    triangles: countTriangles(document),
    simplified: shouldSimplify,
    textures: readTextures(document),
    extensionsUsed: knownExtensionNames(document),
    source,
  };
}
