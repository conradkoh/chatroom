/**
 * Generate 3D — the web variant of a generated GLB.
 *
 * The master GLB is what fal returned; the web variant is a smaller copy for a
 * browser: welded geometry, optionally simplified toward a triangle target, and
 * textures of JPEG, PNG or WebP re-encoded to at most `maxTexturePx` on the
 * longest edge, with the aspect ratio preserved. JPEG is deliberate — WebP or
 * meshopt output would add a GLB extension, and the variant must stay loadable
 * by a plain glTF 2.0 viewer.
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
import type { CompressTextureOptions } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';

import { Generate3dError } from './model-registry.js';

export interface WebVariantOptions {
  /** Target triangle count; paired with a 1% error bound, so it is best effort. */
  triangleTarget: number;
  /** Longest texture edge, in pixels; aspect ratio is preserved. */
  maxTexturePx: number;
  /** Encoder quality for re-encoded colour (sRGB) textures. */
  quality: number;
  /** Encoder quality for data textures: metallic-roughness, occlusion, normal. */
  dataQuality: number;
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
   * `non-destructive` for a skinned or animated mesh, where weld and simplify
   * are skipped; `default` for a plain mesh.
   */
  skinnedPath: 'non-destructive' | 'default';
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

/**
 * A skinned or animated mesh: welding merges vertices and simplify remaps
 * attributes, and neither is worth the risk of losing a joint, a weight, or an
 * animation channel for a size win.
 */
function isSkinnedOrAnimated(document: Document): boolean {
  const root = document.getRoot();
  return root.listSkins().length > 0 || root.listAnimations().length > 0;
}

/**
 * The geometry pass. A skinned or animated mesh skips weld and simplify and is
 * left exactly as it was; a plain mesh is welded and, when over target,
 * simplified.
 */
async function optimizeGeometry(args: {
  document: Document;
  triangles: number;
  opts: WebVariantOptions;
  weld: () => Transform;
  simplifyAt: (ratio: number) => Transform;
}): Promise<{ simplified: boolean; skinnedPath: 'non-destructive' | 'default' }> {
  if (isSkinnedOrAnimated(args.document)) {
    return { simplified: false, skinnedPath: 'non-destructive' };
  }
  const shouldSimplify = args.triangles > args.opts.triangleTarget;
  await args.document.transform(
    args.weld(),
    ...(shouldSimplify ? [args.simplifyAt(args.opts.triangleTarget / args.triangles)] : [])
  );
  return { simplified: shouldSimplify, skinnedPath: 'default' };
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

/** Re-encode one texture in place; `compressTexture` from gltf-transform. */
type CompressTexture = (texture: Texture, options: CompressTextureOptions) => Promise<void>;

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

/** How one texture is encoded: PNG for alpha, otherwise JPEG at its class quality. */
interface TexturePlan {
  targetFormat: 'jpeg' | 'png';
  quality: number;
}

/**
 * Alpha-bound colour maps stay PNG. Colour slots (sRGB) use the colour quality;
 * data maps (metallic-roughness, occlusion, normal, or an orphan texture) use
 * the higher data quality, and `compressTexture` disables chroma subsampling for
 * them on its own.
 */
function texturePlan(
  texture: Texture,
  alphaBound: ReadonlySet<Texture>,
  colourSpace: (texture: Texture) => 'srgb' | null,
  opts: WebVariantOptions
): TexturePlan {
  // Lossless: the PNG encoder ignores quality.
  if (alphaBound.has(texture)) return { targetFormat: 'png', quality: opts.quality };
  const isColour = colourSpace(texture) === 'srgb';
  return { targetFormat: 'jpeg', quality: isColour ? opts.quality : opts.dataQuality };
}

/** Image types `compressTexture` decodes and re-encodes; others stay untouched. */
const COMPRESSIBLE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const WEBP_EXTENSION = 'EXT_texture_webp';

/** Dispose a declared extension by name, so the writer stops declaring it. */
function disposeExtension(document: Document, name: string): void {
  document
    .getRoot()
    .listExtensionsUsed()
    .find((extension) => extension.extensionName === name)
    ?.dispose();
}

/**
 * Re-encode every texture to at most `maxTexturePx` on its longest edge, one
 * texture at a time so an alpha-bearing map can stay PNG while the rest become
 * JPEG.
 *
 * Each texture is encoded from its own bytes: `compressTexture` reads the real
 * image type, unlike a URI pattern, which made WebP bytes look like PNG and
 * stretched them.
 */
async function compressTextures(args: {
  document: Document;
  compressTexture: CompressTexture;
  getTextureColorSpace: (texture: Texture) => 'srgb' | null;
  sharp: unknown;
  opts: WebVariantOptions;
}): Promise<void> {
  const alphaBound = alphaBoundTextures(args.document);
  for (const texture of args.document.getRoot().listTextures()) {
    if (!COMPRESSIBLE_MIME_TYPES.has(texture.getMimeType())) continue;
    const plan = texturePlan(texture, alphaBound, args.getTextureColorSpace, args.opts);
    await args.compressTexture(texture, {
      encoder: args.sharp,
      resize: [args.opts.maxTexturePx, args.opts.maxTexturePx],
      ...plan,
    });
  }
  dropUnusedWebpExtension(args.document);
}

/** Drop the WebP declaration once no WebP texture remains, or plain viewers break. */
function dropUnusedWebpExtension(document: Document): void {
  const stillWebp = document
    .getRoot()
    .listTextures()
    .some((texture) => texture.getMimeType() === 'image/webp');
  if (!stillWebp) disposeExtension(document, WEBP_EXTENSION);
}

/** Draco-compressed geometry needs a decoder this command does not ship. */
const DRACO_EXTENSION = 'KHR_draco_mesh_compression';

/** Meshopt-compressed geometry: readable here, but never written back. */
const MESHOPT_EXTENSION = 'EXT_meshopt_compression';

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
  const [
    { weld, simplify, compressTexture, prune, dedup, getTextureColorSpace },
    { default: sharp },
  ] = await Promise.all([import('@gltf-transform/functions'), import('sharp')]);
  await MeshoptSimplifier.ready;

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const document = await io.readBinary(glb);
  // The decoder already expanded the geometry on read; without this the writer
  // would re-declare `EXT_meshopt_compression` and need a decoder in the browser.
  disposeExtension(document, MESHOPT_EXTENSION);
  // No-op logger: prune() reports every removed property otherwise.
  document.setLogger(SILENT_LOGGER);

  const source = describeDocument(document);
  const geometry = await optimizeGeometry({
    document,
    triangles: source.triangles,
    opts,
    weld: () => weld(),
    simplifyAt: (ratio) =>
      simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01, lockBorder: true }),
  });
  await compressTextures({ document, compressTexture, getTextureColorSpace, sharp, opts });
  await document.transform(prune(), dedup());

  return {
    bytes: await io.writeBinary(document),
    ...describeDocument(document),
    simplified: geometry.simplified,
    skinnedPath: geometry.skinnedPath,
    source,
  };
}
