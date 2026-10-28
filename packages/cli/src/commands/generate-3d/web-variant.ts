/**
 * Generate 3D — the web variant of a generated GLB.
 *
 * The master GLB is what fal returned; the web variant is a smaller copy for a
 * browser: welded geometry, optionally simplified toward a triangle target, and
 * textures downscaled to at most `maxTexturePx` on the longest edge. JPEG is
 * deliberate — WebP or meshopt compression would add a GLB extension, and the
 * variant must stay loadable by a plain glTF 2.0 viewer.
 *
 * Two input features need care:
 *
 * - Alpha. JPEG has no alpha channel, so a texture that a non-OPAQUE material
 *   uses as its base colour is re-encoded as PNG instead. Everything else stays
 *   JPEG.
 * - Compressed master geometry. A master using `EXT_meshopt_compression` loads
 *   through the meshopt decoder registered below. `KHR_draco_mesh_compression`
 *   is refused with a clear error, because decoding it needs a Draco decoder
 *   that this command does not ship.
 *
 * `@gltf-transform/functions` and `sharp` are imported inside the function:
 * `functions` throws at import time when sharp cannot load, so a `generate-3d`
 * run that never builds a package must not pay that cost.
 */

import {
  NodeIO,
  Primitive,
  type Document,
  type Texture,
  type Transform,
} from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';

import { Generate3dError } from './model-registry.js';

export interface WebVariantOptions {
  /** Target triangle count; paired with a 1% error bound, so it is best effort. */
  triangleTarget: number;
  /** Longest texture edge, in pixels; aspect ratio is preserved. */
  maxTexturePx: number;
  /** Encoder quality for re-encoded textures. */
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

/**
 * Triangles in one primitive: indexed count, else the position count, over 3.
 *
 * Only `TRIANGLES` primitives count. A strip or fan packs N triangles into N+1 or
 * N+2 vertices, so dividing their vertex count by 3 would overstate the geometry
 * the package manifest reports and the simplifier targets.
 */
function primitiveTriangles(primitive: Primitive): number {
  if (primitive.getMode() !== Primitive.Mode.TRIANGLES) return 0;
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

/** Texture slots and formats for one optimize pass. */
type TextureCompress = (options: {
  encoder: unknown;
  targetFormat: 'jpeg' | 'png';
  resize: [number, number];
  quality: number;
  pattern: RegExp;
}) => Transform;

/** Every number and picture the package manifest needs about one GLB. */
function describeDocument(document: Document): GlbStats {
  return {
    triangles: countTriangles(document),
    textures: readTextures(document),
    extensionsUsed: knownExtensionNames(document),
  };
}

/**
 * Base-colour textures that a non-OPAQUE material blends or cuts out.
 *
 * Alpha lives in the base-colour map in glTF, so these are the textures a JPEG
 * re-encode would visibly damage; they stay PNG.
 */
function alphaBoundTextures(document: Document): Set<Texture> {
  const textures = new Set<Texture>();
  for (const material of document.getRoot().listMaterials()) {
    if (material.getAlphaMode() === 'OPAQUE') continue;
    const baseColor = material.getBaseColorTexture();
    if (baseColor !== null) textures.add(baseColor);
  }
  return textures;
}

/** Escape a literal string for use inside a `RegExp`. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A pattern matching exactly one texture, by the URI it is given here.
 *
 * The URI needs its image extension: `textureCompress` reads the target format
 * from it, and an extension-less URI makes the encoder write `image/texture-0`
 * instead of a real MIME type.
 */
function texturePattern(texture: Texture, index: number): RegExp {
  const extension = texture.getMimeType() === 'image/jpeg' ? 'jpeg' : 'png';
  const uri = texture.getURI() || `texture-${index}.${extension}`;
  texture.setURI(uri);
  return new RegExp(`^${escapeRegExp(uri)}$`);
}

/**
 * Re-encode every texture to at most `maxTexturePx` on its longest edge, one
 * texture at a time so an alpha-bearing map can stay PNG while the rest become
 * JPEG.
 */
async function compressTextures(args: {
  document: Document;
  textureCompress: TextureCompress;
  sharp: unknown;
  opts: WebVariantOptions;
}): Promise<void> {
  const alphaBound = alphaBoundTextures(args.document);
  for (const [index, texture] of args.document.getRoot().listTextures().entries()) {
    await args.document.transform(
      args.textureCompress({
        encoder: args.sharp,
        targetFormat: alphaBound.has(texture) ? 'png' : 'jpeg',
        resize: [args.opts.maxTexturePx, args.opts.maxTexturePx],
        quality: args.opts.quality,
        pattern: texturePattern(texture, index),
      })
    );
  }
}

/** Draco-compressed geometry needs a decoder this command does not ship. */
const DRACO_EXTENSION = 'KHR_draco_mesh_compression';

/** The glTF JSON chunk of a GLB container, or null when the bytes are not one. */
function readGlbJson(glb: Uint8Array): Record<string, unknown> | null {
  try {
    const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    if (view.getUint32(16, true) !== 0x4e4f534a) return null; // 'JSON'
    const length = view.getUint32(12, true);
    return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + length))) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

/** Extension names a GLB declares as used or required. */
function glbExtensionNames(glb: Uint8Array): string[] {
  const json = readGlbJson(glb);
  if (json === null) return [];
  return [json['extensionsUsed'], json['extensionsRequired']].flatMap((value) =>
    Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string') : []
  );
}

/** Refuse a Draco-compressed master before any texture or geometry work. */
function requireNoDraco(glb: Uint8Array): void {
  if (glbExtensionNames(glb).includes(DRACO_EXTENSION)) {
    throw new Generate3dError(
      `The master GLB uses ${DRACO_EXTENSION}, which this command cannot decode. Re-export it without Draco compression, or build the package by hand.`
    );
  }
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
  requireNoDraco(glb);
  const [{ weld, simplify, textureCompress, prune, dedup }, { default: sharp }] = await Promise.all(
    [import('@gltf-transform/functions'), import('sharp')]
  );
  await MeshoptSimplifier.ready;

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const document = await io.readBinary(glb);
  // No-op logger: prune() reports every removed property otherwise.
  document.setLogger(SILENT_LOGGER);

  const source = describeDocument(document);
  const shouldSimplify = source.triangles > opts.triangleTarget;
  await document.transform(
    weld(),
    ...(shouldSimplify
      ? [
          simplify({
            simplifier: MeshoptSimplifier,
            ratio: opts.triangleTarget / source.triangles,
            error: 0.01,
            lockBorder: true,
          }),
        ]
      : [])
  );
  await compressTextures({ document, textureCompress, sharp, opts });
  await document.transform(prune(), dedup());

  return {
    bytes: await io.writeBinary(document),
    ...describeDocument(document),
    simplified: shouldSimplify,
    source,
  };
}
