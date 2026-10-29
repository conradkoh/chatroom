/**
 * Web variant tests.
 *
 * These build small GLBs in memory, so the optimizer runs for real (including
 * `sharp`) without any network, fixture file, or fal call. They pin the numbers
 * the package manifest depends on — triangle count, whether simplify ran, the
 * texture format and size — plus the two input features the transform has to
 * respect: alpha and primitive modes.
 */

import { Document, NodeIO, Primitive } from '@gltf-transform/core';
import {
  ALL_EXTENSIONS,
  EXTTextureWebP,
  KHRMaterialsSpecular,
  KHRTextureBasisu,
} from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { analyseDocument } from './asset-analysis.js';
import { createWebVariant, type ProcessedVariant, type WebVariantOptions } from './web-variant.js';

const OPTIONS: WebVariantOptions = {
  triangleTarget: 30_000,
  maxTexturePx: 1024,
  quality: 80,
  dataQuality: 95,
};

function glbIo(): NodeIO {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS);
}

interface BuildGlbOptions {
  positions: Float32Array;
  indices?: Uint32Array | undefined;
  /** Base-colour texture bytes and MIME type. */
  texture?: { bytes: Uint8Array; mimeType: string } | undefined;
  /** Metallic-roughness texture bytes and MIME type. */
  dataTexture?: { bytes: Uint8Array; mimeType: string } | undefined;
  alphaMode?: 'OPAQUE' | 'BLEND' | undefined;
  /** glTF primitive mode; defaults to TRIANGLES. */
  mode?: ReturnType<Primitive['getMode']> | undefined;
  /** Declare `EXT_texture_webp` as required, as a WebP master does. */
  declareWebp?: boolean | undefined;
  /** Declare `KHR_texture_basisu` as required, as a KTX2 master does. */
  declareBasisu?: boolean | undefined;
  /** Use the base-colour texture in the metallic-roughness slot too. */
  shareTextureWithData?: boolean | undefined;
  /** A texture in `KHR_materials_specular`'s alpha-carrying slot. */
  specularTexture?: { bytes: Uint8Array; mimeType: string } | undefined;
}

/** One mesh, one primitive, an optional material, written as a real GLB. */
async function buildGlb(opts: BuildGlbOptions): Promise<Uint8Array> {
  const document = new Document();
  const buffer = document.createBuffer();
  if (opts.declareWebp === true) document.createExtension(EXTTextureWebP).setRequired(true);
  if (opts.declareBasisu === true) document.createExtension(KHRTextureBasisu).setRequired(true);
  // Copy into fresh typed arrays: accessors require `ArrayBuffer`-backed views.
  const position = document
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array(opts.positions))
    .setBuffer(buffer);
  const primitive = document.createPrimitive().setAttribute('POSITION', position);
  if (opts.indices !== undefined) {
    const indices = document
      .createAccessor()
      .setType('SCALAR')
      .setArray(new Uint32Array(opts.indices))
      .setBuffer(buffer);
    primitive.setIndices(indices);
  }
  if (opts.mode !== undefined) primitive.setMode(opts.mode);
  if (
    opts.texture !== undefined ||
    opts.dataTexture !== undefined ||
    opts.specularTexture !== undefined
  ) {
    const material = document.createMaterial('mat').setAlphaMode(opts.alphaMode ?? 'OPAQUE');
    if (opts.texture !== undefined) {
      material.setBaseColorTexture(
        document
          .createTexture('base')
          .setImage(opts.texture.bytes)
          .setMimeType(opts.texture.mimeType)
      );
    }
    if (opts.dataTexture !== undefined) {
      material.setMetallicRoughnessTexture(
        document
          .createTexture('data')
          .setImage(opts.dataTexture.bytes)
          .setMimeType(opts.dataTexture.mimeType)
      );
    }
    if (opts.shareTextureWithData === true) {
      const shared = material.getBaseColorTexture();
      if (shared !== null) material.setMetallicRoughnessTexture(shared);
    }
    if (opts.specularTexture !== undefined) {
      const specular = document.createExtension(KHRMaterialsSpecular).createSpecular();
      material.setExtension('KHR_materials_specular', specular);
      specular.setSpecularTexture(
        document
          .createTexture('specular')
          .setImage(opts.specularTexture.bytes)
          .setMimeType(opts.specularTexture.mimeType)
      );
    }
    primitive.setMaterial(material);
  }
  const mesh = document.createMesh().addPrimitive(primitive);
  document.createScene().addChild(document.createNode().setMesh(mesh));
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

/**
 * A 2048x2048 PNG with varied pixels, so sharp has something to re-encode.
 *
 * It must not be a single flat colour: `prune()` drops solid textures, which
 * would make the texture assertions test that optimisation instead of the
 * encoder.
 */
async function pngTexture(): Promise<Uint8Array> {
  const side = 2048;
  const pixels = Buffer.alloc(side * side * 4);
  for (let index = 0; index < side * side; index += 1) {
    pixels[index * 4] = (index * 7) % 256;
    pixels[index * 4 + 1] = (index * 13) % 256;
    pixels[index * 4 + 2] = (index * 29) % 256;
    pixels[index * 4 + 3] = 255;
  }
  const bytes = await sharp(pixels, { raw: { width: side, height: side, channels: 4 } })
    .png()
    .toBuffer();
  return new Uint8Array(bytes);
}

/** A `width` x `height` RGBA image with varied pixels, so prune keeps it. */
async function texturePixels(width: number, height: number): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      pixels[index] = (x * 7 + y * 3) % 256;
      pixels[index + 1] = (x + y * 13) % 256;
      pixels[index + 2] = (x * 29 + y * 5) % 256;
      pixels[index + 3] = 255;
    }
  }
  return pixels;
}

/** A smooth RGB gradient with far more than 256 distinct colours. */
async function gradientTexture(): Promise<Uint8Array> {
  const width = 512;
  const height = 512;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      pixels[index] = x % 256;
      pixels[index + 1] = y % 256;
      pixels[index + 2] = (x + y) % 256;
      pixels[index + 3] = 255;
    }
  }
  return new Uint8Array(
    await sharp(pixels, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer()
  );
}

/** Distinct RGBA values in an encoded image, decoded with sharp. */
async function distinctColours(bytes: Uint8Array): Promise<number> {
  const { data, info } = await sharp(Buffer.from(bytes))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const seen = new Set<number>();
  for (let index = 0; index < data.length; index += info.channels) {
    const value =
      ((data[index] ?? 0) << 24) |
      ((data[index + 1] ?? 0) << 16) |
      ((data[index + 2] ?? 0) << 8) |
      (data[index + 3] ?? 0);
    seen.add(value >>> 0);
  }
  return seen.size;
}

/** The same varied image, encoded as PNG, JPEG, or WebP. */
async function encodedTexture(
  width: number,
  height: number,
  format: 'png' | 'jpeg' | 'webp'
): Promise<Uint8Array> {
  const image = sharp(await texturePixels(width, height), {
    raw: { width, height, channels: 4 },
  });
  const bytes =
    format === 'png'
      ? await image.png().toBuffer()
      : format === 'jpeg'
        ? await image.jpeg({ quality: 95 }).toBuffer()
        : await image.webp({ quality: 95 }).toBuffer();
  return new Uint8Array(bytes);
}

/** A 256x256 MR map: left half blue 255 (metal), right half blue 40 (weak). */
async function splitMetalTexture(): Promise<Uint8Array> {
  const width = 256;
  const height = 256;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      pixels[index] = 0;
      pixels[index + 1] = 128;
      pixels[index + 2] = x < width / 2 ? 255 : 40;
      pixels[index + 3] = 255;
    }
  }
  const bytes = await sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  return new Uint8Array(bytes);
}

/** A unit box from -0.5 to 0.5, for the fit test. */
async function buildUnitBoxGlb(): Promise<Uint8Array> {
  const document = new Document();
  const buffer = document.createBuffer();
  const positions = document
    .createAccessor('positions')
    .setType('VEC3')
    .setArray(
      new Float32Array([
        -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5,
        -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
      ])
    )
    .setBuffer(buffer);
  const indices = document
    .createAccessor('indices')
    .setType('SCALAR')
    .setArray(
      new Uint16Array([
        4, 5, 6, 4, 6, 7, 1, 0, 3, 1, 3, 2, 0, 4, 7, 0, 7, 3, 5, 1, 2, 5, 2, 6, 3, 7, 6, 3, 6, 2, 0,
        1, 5, 0, 5, 4,
      ])
    )
    .setBuffer(buffer);
  const primitive = document
    .createPrimitive()
    .setAttribute('POSITION', positions)
    .setIndices(indices);
  const mesh = document.createMesh('box').addPrimitive(primitive);
  document.createScene('scene').addChild(document.createNode('box-node').setMesh(mesh));
  return glbIo().writeBinary(document);
}

/** Real pixel size and format of each texture, read with sharp from the bytes. */
async function realSize(glb: Uint8Array): Promise<
  {
    width: number | undefined;
    height: number | undefined;
    format: string | undefined;
    chromaSubsampling: string | undefined;
  }[]
> {
  const document = await glbIo().readBinary(glb);
  return Promise.all(
    document
      .getRoot()
      .listTextures()
      .map(async (texture) => {
        const metadata = await sharp(
          Buffer.from(texture.getImage() ?? new Uint8Array())
        ).metadata();
        return {
          width: metadata.width,
          height: metadata.height,
          format: metadata.format,
          chromaSubsampling: metadata.chromaSubsampling,
        };
      })
  );
}

/** Extension names a GLB declares as required, read from its JSON chunk. */
function declaredRequired(glb: Uint8Array): string[] {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength))) as {
    extensionsRequired?: string[];
  };
  return json.extensionsRequired ?? [];
}

/**
 * A GLB whose geometry is meshopt-compressed, to prove the variant strips it.
 *
 * `ALL_EXTENSIONS` already carries `EXTMeshoptCompression`; the encoder and
 * decoder dependencies are what make it usable.
 */
async function meshoptCompressedGlb(source: Uint8Array): Promise<Uint8Array> {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  const document = await io.readBinary(source);
  await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  return io.writeBinary(document);
}

/** Extension names a GLB declares, read straight from its JSON chunk. */
function declaredExtensions(glb: Uint8Array): string[] {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength))) as {
    extensionsUsed?: string[];
  };
  return json.extensionsUsed ?? [];
}

/** Rebuild a GLB with extra `extensionsUsed`, keeping every chunk length valid. */
function withExtensionsUsed(glb: Uint8Array, extensions: string[]): Uint8Array {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength))) as Record<
    string,
    unknown
  >;
  json['extensionsUsed'] = extensions;
  const chunk = new TextEncoder().encode(JSON.stringify(json));
  const padded = new Uint8Array(Math.ceil(chunk.length / 4) * 4).fill(0x20);
  padded.set(chunk);
  // Keep the BIN chunk (and its header) exactly as it was.
  const rest = glb.subarray(20 + jsonLength);
  const total = 20 + padded.length + rest.length;
  const out = new Uint8Array(total);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, 0x46546c67, true); // 'glTF'
  outView.setUint32(4, 2, true);
  outView.setUint32(8, total, true);
  outView.setUint32(12, padded.length, true);
  outView.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(padded, 20);
  out.set(rest, 20 + padded.length);
  return out;
}

/** A minimal, valid KTX2 container: identifier, header, level index, and DFD. */
function ktx2Bytes(width: number, height: number): Uint8Array {
  const identifier = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
  const headerLength = 17 * 4;
  const levelIndexLength = 24;
  const dfdLength = 28;
  const dfdOffset = identifier.length + headerLength + levelIndexLength;
  const levelDataOffset = dfdOffset + dfdLength;
  const bytes = Buffer.alloc(levelDataOffset);
  identifier.forEach((value, index) => bytes.writeUInt8(value, index));

  const header = [
    0, // vkFormat: undefined
    1, // typeSize
    width,
    height,
    0, // pixelDepth
    0, // layerCount
    1, // faceCount
    1, // levelCount
    0, // supercompressionScheme
    dfdOffset,
    dfdLength,
    0, // kvdByteOffset
    0, // kvdByteLength
  ];
  header.forEach((value, index) => bytes.writeUInt32LE(value, identifier.length + index * 4));
  bytes.writeBigUInt64LE(BigInt(0), identifier.length + 52); // sgdByteOffset
  bytes.writeBigUInt64LE(BigInt(0), identifier.length + 60); // sgdByteLength

  const levelOffset = identifier.length + headerLength;
  bytes.writeBigUInt64LE(BigInt(levelDataOffset), levelOffset);
  bytes.writeBigUInt64LE(BigInt(0), levelOffset + 8);
  bytes.writeBigUInt64LE(BigInt(0), levelOffset + 16);

  bytes.writeUInt32LE(dfdLength, dfdOffset); // totalSize
  bytes.writeUInt16LE(0, dfdOffset + 4); // vendorId
  bytes.writeUInt16LE(0, dfdOffset + 6); // descriptorType
  bytes.writeUInt16LE(2, dfdOffset + 8); // versionNumber
  bytes.writeUInt16LE(24, dfdOffset + 10); // descriptorBlockSize: no samples
  return new Uint8Array(bytes);
}

/** A skinned, animated GLB: two joints, JOINTS_0/WEIGHTS_0, one rotation channel. */
async function buildSkinnedGlb(texture?: {
  bytes: Uint8Array;
  mimeType: string;
  declareWebp?: boolean;
}): Promise<Uint8Array> {
  const document = new Document();
  if (texture?.declareWebp === true) document.createExtension(EXTTextureWebP).setRequired(true);
  const buffer = document.createBuffer();
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1]);
  const position = document.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer);
  const joints = document
    .createAccessor()
    .setType('VEC4')
    .setArray(new Uint16Array([0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]))
    .setBuffer(buffer);
  const weights = document
    .createAccessor()
    .setType('VEC4')
    .setArray(new Float32Array(16).fill(0.5))
    .setBuffer(buffer);
  const indices = document
    .createAccessor()
    .setType('SCALAR')
    .setArray(new Uint32Array([0, 1, 2, 2, 1, 3]))
    .setBuffer(buffer);
  const inverseBind = document
    .createAccessor()
    .setType('MAT4')
    .setArray(new Float32Array(32))
    .setBuffer(buffer);

  const primitive = document
    .createPrimitive()
    .setAttribute('POSITION', position)
    .setAttribute('JOINTS_0', joints)
    .setAttribute('WEIGHTS_0', weights)
    .setIndices(indices);
  if (texture !== undefined) {
    const image = document
      .createTexture('skin')
      .setImage(texture.bytes)
      .setMimeType(texture.mimeType);
    primitive.setMaterial(document.createMaterial('skin').setBaseColorTexture(image));
  }
  const mesh = document.createMesh().addPrimitive(primitive);

  const jointA = document.createNode('jointA');
  const jointB = document.createNode('jointB');
  const skin = document
    .createSkin('rig')
    .addJoint(jointA)
    .addJoint(jointB)
    .setInverseBindMatrices(inverseBind);

  const scene = document.createScene();
  scene.addChild(document.createNode('mesh').setMesh(mesh).setSkin(skin));
  scene.addChild(jointA);
  scene.addChild(jointB);

  const input = document
    .createAccessor()
    .setType('SCALAR')
    .setArray(new Float32Array([0, 1]))
    .setBuffer(buffer);
  const output = document
    .createAccessor()
    .setType('VEC4')
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]))
    .setBuffer(buffer);
  const sampler = document
    .createAnimationSampler()
    .setInput(input)
    .setOutput(output)
    .setInterpolation('LINEAR');
  const channel = document
    .createAnimationChannel()
    .setTargetNode(jointA)
    .setTargetPath('rotation')
    .setSampler(sampler);
  document.createAnimation('spin').addSampler(sampler).addChannel(channel);

  return glbIo().writeBinary(document);
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

  it('counts a non-indexed primitive by its position count', async () => {
    // Six vertices, no indices: two triangles.
    const glb = await buildGlb({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 2, 0, 0, 3, 0, 0, 2, 0, 1]),
    });

    const variant = await createWebVariant(glb, OPTIONS);

    expect(variant.triangles).toBe(2);
  });

  it('ignores strip and fan primitives, which do not divide by three', async () => {
    const strip = await buildGlb({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1]),
      mode: Primitive.Mode.TRIANGLE_STRIP,
    });
    const triangles = await buildGlb(disjointTriangles(2));

    expect((await createWebVariant(strip, OPTIONS)).triangles).toBe(0);
    expect((await createWebVariant(triangles, OPTIONS)).triangles).toBe(2);
  });

  it('simplifies toward the target and gets within a small margin', async () => {
    const glb = await buildGlb(grid(10)); // 200 triangles
    const sourceTriangles = 200;

    const variant = await createWebVariant(glb, { ...OPTIONS, triangleTarget: 50 });

    expect(variant.simplified).toBe(true);
    // Best effort: the target is approached, not guaranteed exactly.
    expect(variant.triangles).toBeLessThanOrEqual(60);
    expect(variant.triangles).toBeGreaterThan(0);
    expect(variant.triangles).toBeLessThan(sourceTriangles * 0.5);
  });

  it('reports simplified when disjoint geometry cannot reach the target', async () => {
    // Separate triangles share no edge, so simplify can only drop whole
    // components; the target is unreachable but the attempt still happened.
    const glb = await buildGlb(disjointTriangles(40));

    const variant = await createWebVariant(glb, { ...OPTIONS, triangleTarget: 10 });

    expect(variant.simplified).toBe(true);
    expect(variant.triangles).toBeLessThanOrEqual(120);
  });

  it('re-encodes an opaque base-colour texture as JPEG at the pixel cap', async () => {
    const glb = await buildGlb({
      ...disjointTriangles(2),
      texture: { bytes: await pngTexture(), mimeType: 'image/png' },
    });

    const variant = await createWebVariant(glb, { ...OPTIONS, maxTexturePx: 1024 });

    expect(variant.textures).toHaveLength(1);
    expect(variant.textures[0]?.mimeType).toBe('image/jpeg');
    expect(Math.max(variant.textures[0]?.width ?? 0, variant.textures[0]?.height ?? 0)).toBe(1024);
    expect(variant.textures[0]?.width).toBe(1024);

    // The texture survives serialisation, still as JPEG.
    const reread = await glbIo().readBinary(variant.bytes);
    expect(reread.getRoot().listTextures()[0]?.getMimeType()).toBe('image/jpeg');
  });

  it('keeps an alpha-bound base colour as truecolour PNG, not a 256-colour palette', async () => {
    const glb = await buildGlb({
      ...disjointTriangles(2),
      texture: { bytes: await gradientTexture(), mimeType: 'image/png' },
      alphaMode: 'BLEND',
    });

    const variant = await createWebVariant(glb, OPTIONS);

    expect(variant.textures[0]?.mimeType).toBe('image/png');
    const reread = await glbIo().readBinary(variant.bytes);
    const image = reread.getRoot().listTextures()[0]?.getImage();
    expect(image).toBeTruthy();
    expect(await distinctColours(image ?? new Uint8Array())).toBeGreaterThan(256);
  });

  it('keeps a texture PNG when a blending material relies on its alpha', async () => {
    const glb = await buildGlb({
      ...disjointTriangles(2),
      texture: { bytes: await pngTexture(), mimeType: 'image/png' },
      alphaMode: 'BLEND',
    });

    const variant = await createWebVariant(glb, { ...OPTIONS, maxTexturePx: 1024 });

    expect(variant.textures[0]?.mimeType).toBe('image/png');
    expect(variant.textures[0]?.width).toBe(1024);
  });

  it.each(['image/png', 'image/jpeg', 'image/webp'] as const)(
    'keeps the aspect ratio when re-encoding a 2048x512 %s texture',
    async (mimeType) => {
      const format = mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpeg' : 'webp';
      const glb = await buildGlb({
        ...disjointTriangles(2),
        texture: { bytes: await encodedTexture(2048, 512, format), mimeType },
        declareWebp: mimeType === 'image/webp',
      });

      const variant = await createWebVariant(glb, OPTIONS);

      expect(variant.textures).toEqual([{ width: 1024, height: 256, mimeType: 'image/jpeg' }]);
      expect(await realSize(variant.bytes)).toEqual([
        expect.objectContaining({ width: 1024, height: 256, format: 'jpeg' }),
      ]);
    }
  );

  it('keeps the aspect ratio of a 2048x1024 source', async () => {
    const glb = await buildGlb({
      ...disjointTriangles(2),
      texture: { bytes: await encodedTexture(2048, 1024, 'png'), mimeType: 'image/png' },
    });

    const variant = await createWebVariant(glb, OPTIONS);

    expect(variant.textures[0]).toMatchObject({ width: 1024, height: 512 });
  });

  it('keeps the aspect ratio of a non-power-of-two PNG source within a pixel', async () => {
    const glb = await buildGlb({
      ...disjointTriangles(2),
      texture: { bytes: await encodedTexture(1500, 700, 'png'), mimeType: 'image/png' },
    });

    const variant = await createWebVariant(glb, OPTIONS);

    const [real] = await realSize(variant.bytes);
    expect(real?.width).toBe(1024);
    expect(Math.abs((real?.height ?? 0) - 478)).toBeLessThanOrEqual(1);
  });

  it('keeps the aspect ratio of a non-power-of-two WebP source within a pixel', async () => {
    const glb = await buildGlb({
      ...disjointTriangles(2),
      texture: { bytes: await encodedTexture(1500, 700, 'webp'), mimeType: 'image/webp' },
      declareWebp: true,
    });

    const variant = await createWebVariant(glb, OPTIONS);

    const [real] = await realSize(variant.bytes);
    expect(real?.width).toBe(1024);
    expect(Math.abs((real?.height ?? 0) - 478)).toBeLessThanOrEqual(1);
    expect(real?.format).toBe('jpeg');
  });

  it('converts a WebP master and drops the WebP extension', async () => {
    const glb = await buildGlb({
      ...disjointTriangles(2),
      texture: { bytes: await encodedTexture(2048, 512, 'webp'), mimeType: 'image/webp' },
      declareWebp: true,
    });
    expect(declaredExtensions(glb)).toContain('EXT_texture_webp');
    expect(declaredRequired(glb)).toContain('EXT_texture_webp');

    const variant = await createWebVariant(glb, OPTIONS);

    expect(variant.textures).toEqual([{ width: 1024, height: 256, mimeType: 'image/jpeg' }]);
    expect(variant.extensionsUsed).toEqual([]);
    expect(declaredRequired(variant.bytes)).not.toContain('EXT_texture_webp');
  });

  it('keeps a WebP alpha-bound base colour as PNG', async () => {
    const glb = await buildGlb({
      ...disjointTriangles(2),
      texture: { bytes: await encodedTexture(2048, 512, 'webp'), mimeType: 'image/webp' },
      declareWebp: true,
      alphaMode: 'BLEND',
    });

    const variant = await createWebVariant(glb, OPTIONS);

    expect(variant.textures[0]).toMatchObject({
      width: 1024,
      height: 256,
      mimeType: 'image/png',
    });
    expect(variant.extensionsUsed).toEqual([]);
    expect(declaredRequired(variant.bytes)).not.toContain('EXT_texture_webp');
  });

  it('keeps skins and animations when a skinned mesh has a WebP texture', async () => {
    const glb = await buildSkinnedGlb({
      bytes: await encodedTexture(2048, 512, 'webp'),
      mimeType: 'image/webp',
      declareWebp: true,
    });

    const variant = await createWebVariant(glb, OPTIONS);

    expect(variant.skinnedPath).toBe('non-destructive');
    expect(variant.textures[0]).toMatchObject({
      width: 1024,
      height: 256,
      mimeType: 'image/jpeg',
    });

    const reread = await glbIo().readBinary(variant.bytes);
    const root = reread.getRoot();
    expect(root.listSkins()).toHaveLength(1);
    const primitive = root.listMeshes()[0]?.listPrimitives()[0];
    expect(primitive?.getAttribute('JOINTS_0')).not.toBeNull();
    expect(primitive?.getAttribute('WEIGHTS_0')).not.toBeNull();
    expect(root.listAnimations()).toHaveLength(1);
    expect(await realSize(variant.bytes)).toEqual([
      expect.objectContaining({ width: 1024, height: 256, format: 'jpeg' }),
    ]);
  });

  it('encodes a metallic-roughness map at higher quality without chroma subsampling', async () => {
    const glb = await buildGlb({
      ...disjointTriangles(2),
      texture: { bytes: await encodedTexture(2048, 512, 'png'), mimeType: 'image/png' },
      dataTexture: { bytes: await encodedTexture(2048, 512, 'png'), mimeType: 'image/png' },
    });

    const variant = await createWebVariant(glb, OPTIONS);

    const reread = await glbIo().readBinary(variant.bytes);
    const material = reread.getRoot().listMaterials()[0];
    const base = material?.getBaseColorTexture();
    const data = material?.getMetallicRoughnessTexture();
    expect(base).toBeTruthy();
    expect(data).toBeTruthy();

    const baseMeta = await sharp(Buffer.from(base?.getImage() ?? new Uint8Array())).metadata();
    const dataMeta = await sharp(Buffer.from(data?.getImage() ?? new Uint8Array())).metadata();
    expect(baseMeta.format).toBe('jpeg');
    expect(baseMeta.chromaSubsampling).toBe('4:2:0');
    expect(dataMeta.format).toBe('jpeg');
    expect(dataMeta.chromaSubsampling).toBe('4:4:4');
    expect(baseMeta.width).toBe(1024);
    expect(dataMeta.width).toBe(1024);
  });

  it('masks weak metal before the metallic-roughness JPEG is written', async () => {
    const glb = await buildGlb({
      ...disjointTriangles(2),
      dataTexture: { bytes: await splitMetalTexture(), mimeType: 'image/png' },
    });

    const variant = await createWebVariant(glb, OPTIONS);

    const reread = await glbIo().readBinary(variant.bytes);
    const image = reread.getRoot().listMaterials()[0]?.getMetallicRoughnessTexture()?.getImage();
    const { data, info } = await sharp(Buffer.from(image ?? new Uint8Array()))
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    const blueAt = (x: number, y: number): number => data[(y * info.width + x) * 4 + 2] ?? 0;

    expect(blueAt(64, 128)).toBeGreaterThan(240);
    expect(blueAt(192, 128)).toBeLessThan(10);
  });

  it('fits the web document when a fit is passed', async () => {
    const variant = await createWebVariant(await buildUnitBoxGlb(), {
      ...OPTIONS,
      fit: { origin: 'feet', targetHeight: 2 },
    });

    const analysis = await analyseDocument(await glbIo().readBinary(variant.bytes));

    expect(analysis.bounds.min[1]).toBeCloseTo(0, 6);
    expect(analysis.bounds.max[1] - analysis.bounds.min[1]).toBeCloseTo(2, 6);
    expect(variant.fit?.scale).toBeCloseTo(2, 6);
  });

  it('skips normalisation and fit when given processed decisions', async () => {
    const glb = await buildGlb({
      ...disjointTriangles(2),
      dataTexture: { bytes: await splitMetalTexture(), mimeType: 'image/png' },
    });
    const processed: ProcessedVariant = {
      materials: [
        {
          index: 0,
          name: 'mat',
          decision: 'metal-masked',
          metalFraction: 0.5,
          maskedFraction: 0.5,
        },
      ],
      fit: {
        origin: 'feet',
        targetHeight: 2,
        scale: 2,
        bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      },
    };

    const variant = await createWebVariant(glb, { ...OPTIONS, processed });

    expect(variant.materials).toEqual(processed.materials);
    expect(variant.fit).toEqual(processed.fit);
    const reread = await glbIo().readBinary(variant.bytes);
    const image = reread.getRoot().listMaterials()[0]?.getMetallicRoughnessTexture()?.getImage();
    const { data, info } = await sharp(Buffer.from(image ?? new Uint8Array()))
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const blueAt = (x: number, y: number): number => data[(y * info.width + x) * 4 + 2] ?? 0;
    expect(blueAt(64, 128)).toBeGreaterThan(240);
    expect(blueAt(192, 128)).toBeGreaterThan(25);
    expect(blueAt(192, 128)).toBeLessThan(55);
  });

  it('does not re-apply the fit when processed decisions are given', async () => {
    const processed: ProcessedVariant = {
      materials: [],
      fit: {
        origin: 'feet',
        targetHeight: 2,
        scale: 2,
        bounds: { min: [0, 0, 0], max: [1, 2, 1] },
      },
    };

    const variant = await createWebVariant(await buildUnitBoxGlb(), { ...OPTIONS, processed });

    const analysis = await analyseDocument(await glbIo().readBinary(variant.bytes));
    expect(analysis.bounds.max[1] - analysis.bounds.min[1]).toBeCloseTo(1, 6);
    expect(variant.fit).toEqual(processed.fit);
  });

  it('spends more bytes on a data map at dataQuality 95 than at 60', async () => {
    const glb = await buildGlb({
      ...disjointTriangles(2),
      dataTexture: { bytes: await encodedTexture(2048, 512, 'png'), mimeType: 'image/png' },
    });

    const high = await createWebVariant(glb, { ...OPTIONS, dataQuality: 95 });
    const low = await createWebVariant(glb, { ...OPTIONS, dataQuality: 60 });
    const dataBytes = async (variant: Awaited<ReturnType<typeof createWebVariant>>) => {
      const reread = await glbIo().readBinary(variant.bytes);
      return (
        reread.getRoot().listMaterials()[0]?.getMetallicRoughnessTexture()?.getImage()
          ?.byteLength ?? 0
      );
    };

    expect(await dataBytes(high)).toBeGreaterThan(await dataBytes(low));
  });

  it('adds no extensions even when it re-encodes textures', async () => {
    const glb = await buildGlb({
      ...disjointTriangles(4),
      texture: { bytes: await pngTexture(), mimeType: 'image/png' },
    });

    const variant = await createWebVariant(glb, { ...OPTIONS, maxTexturePx: 256, quality: 60 });

    expect(variant.extensionsUsed).toEqual([]);
  });

  it('reads a meshopt-compressed master and writes the variant uncompressed', async () => {
    const compressed = await meshoptCompressedGlb(await buildGlb(grid(4)));
    expect(declaredExtensions(compressed)).toContain('EXT_meshopt_compression');

    const variant = await createWebVariant(compressed, OPTIONS);

    expect(variant.extensionsUsed).not.toContain('EXT_meshopt_compression');
    expect(variant.triangles).toBe(32);
    expect(Buffer.from(variant.bytes).subarray(0, 4).toString('latin1')).toBe('glTF');
  });

  it('keeps skins, joint attributes, and animations on a skinned mesh', async () => {
    const glb = await buildSkinnedGlb();

    const variant = await createWebVariant(glb, OPTIONS);

    expect(variant.skinnedPath).toBe('non-destructive');
    expect(variant.simplified).toBe(false);

    const reread = await glbIo().readBinary(variant.bytes);
    const root = reread.getRoot();
    expect(root.listSkins()).toHaveLength(1);
    const primitive = root.listMeshes()[0]?.listPrimitives()[0];
    expect(primitive?.getAttribute('JOINTS_0')).not.toBeNull();
    expect(primitive?.getAttribute('WEIGHTS_0')).not.toBeNull();
    expect(root.listAnimations()).toHaveLength(1);
    expect(root.listAnimations()[0]?.listChannels()).toHaveLength(1);
  });

  it('reports the default path for a plain mesh', async () => {
    const variant = await createWebVariant(await buildGlb(disjointTriangles(2)), OPTIONS);

    expect(variant.skinnedPath).toBe('default');
  });

  it('leaves a KTX2 texture byte-identical and keeps its extension', async () => {
    const ktx2 = ktx2Bytes(1024, 1024);
    const glb = await buildGlb({
      ...disjointTriangles(2),
      texture: { bytes: ktx2, mimeType: 'image/ktx2' },
      declareBasisu: true,
    });

    const variant = await createWebVariant(glb, OPTIONS);

    expect(variant.extensionsUsed).toContain('KHR_texture_basisu');
    const reread = await glbIo().readBinary(variant.bytes);
    const texture = reread.getRoot().listTextures()[0];
    expect(texture?.getMimeType()).toBe('image/ktx2');
    expect(Buffer.from(texture?.getImage() ?? new Uint8Array()).equals(Buffer.from(ktx2))).toBe(
      true
    );
  });

  it('treats a texture shared by a colour and a data slot as colour', async () => {
    const glb = await buildGlb({
      ...disjointTriangles(2),
      texture: { bytes: await encodedTexture(2048, 512, 'png'), mimeType: 'image/png' },
      shareTextureWithData: true,
    });

    const variant = await createWebVariant(glb, OPTIONS);

    expect(variant.textures).toHaveLength(1);
    const [real] = await realSize(variant.bytes);
    expect(real?.format).toBe('jpeg');
    expect(real?.chromaSubsampling).toBe('4:2:0');
  });

  it('keeps a texture with an alpha channel in a non-colour slot as PNG', async () => {
    const glb = await buildGlb({
      ...disjointTriangles(2),
      specularTexture: { bytes: await encodedTexture(2048, 512, 'png'), mimeType: 'image/png' },
    });

    const variant = await createWebVariant(glb, OPTIONS);

    expect(variant.textures[0]).toMatchObject({
      width: 1024,
      height: 256,
      mimeType: 'image/png',
    });
    const [real] = await realSize(variant.bytes);
    expect(real?.format).toBe('png');
  });

  it('refuses a Draco-compressed master with an error naming the extension', async () => {
    const glb = withExtensionsUsed(await buildGlb(disjointTriangles(2)), [
      'KHR_draco_mesh_compression',
    ]);

    await expect(createWebVariant(glb, OPTIONS)).rejects.toThrow(
      /KHR_draco_mesh_compression.*cannot decode/
    );
  });

  it('loads a master that declares other extensions', async () => {
    const glb = withExtensionsUsed(await buildGlb(disjointTriangles(2)), ['KHR_materials_unlit']);

    const variant = await createWebVariant(glb, OPTIONS);

    expect(variant.triangles).toBe(2);
  });
});
