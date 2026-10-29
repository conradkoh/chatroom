/**
 * Generate 3D — make every material's metalness explicit and sane.
 *
 * fal's models often return a single material with `metallicFactor` 1 and a
 * metallic-roughness texture whose blue channel is mostly low. At factor 1 the
 * texture's weak blue values still read as partly metal, so wood and clay look
 * metallic. This module resolves each material once:
 *
 * - No metallic-roughness texture and factor 1: set factor 0. A constant metal
 *   with no texture is almost always a model default, not an intent.
 * - Texture with fewer than 1% metal texels: set factor 0, keep the texture.
 *   The green (roughness) channel must stay exactly as the model produced it.
 * - Texture with real metal: keep factor 1 and zero the weak blue values, so
 *   only the strongly metal texels stay metal. Everything else is untouched.
 *
 * The function mutates the document it is given and returns one decision per
 * material; it never re-analyses. Decoding and re-encoding is lossless PNG, so
 * the roughness channel survives exactly. A texture used by more than one slot
 * or material is cloned before masking, so no other material or base-colour
 * output changes.
 */

import type { Document, Material, Texture } from '@gltf-transform/core';
import type sharp from 'sharp';

import {
  DECODABLE_IMAGE_MIME_TYPES,
  type AssetAnalysis,
  type ChannelStats,
  type MaterialStats,
} from './asset-analysis.js';

/** A material is non-metal when fewer than this fraction of its texels are metal. */
// fallow-ignore-next-line unused-export
export const NON_METAL_FRACTION_MAX = 0.01;

/** Blue values below this byte become non-metal in a metal material (128/255 ≈ 0.5). */
// fallow-ignore-next-line unused-export
export const METAL_MASK_THRESHOLD = 128;

/**
 * Byte at or below one tenth of full scale (25/255 ≈ 0.098).
 *
 * Values here were already non-metal, so masking them changes nothing visually.
 * They are zeroed like every other sub-threshold texel but are not counted in
 * `maskedFraction`: that number reports the ambiguous "partly metal" band the
 * triage measured, which is what the decision needs to explain.
 */
const NON_METAL_TENTH_BYTE = 25;

/** One material's normalisation outcome. */
export type MaterialDecision =
  | { index: number; name: string | null; decision: 'non-metal'; metalFraction: number }
  | {
      index: number;
      name: string | null;
      decision: 'metal-masked';
      metalFraction: number;
      maskedFraction: number;
    }
  | { index: number; name: string | null; decision: 'unchanged'; reason: string };

/** The sharp factory the caller imported dynamically. */
type SharpFactory = typeof sharp;

/** Material display name, or null when the model left it empty. */
function materialName(material: Material): string | null {
  return material.getName() || null;
}

/** One decision for a material whose factor is already explicit or untextured. */
function untexturedDecision(index: number, material: Material): MaterialDecision {
  const name = materialName(material);
  if (material.getMetallicFactor() !== 1) {
    return { index, name, decision: 'unchanged', reason: 'explicit-factor' };
  }
  material.setMetallicFactor(0);
  return { index, name, decision: 'non-metal', metalFraction: 0 };
}

/** How many materials use each metallic-roughness texture. */
function metallicRoughnessUseCounts(materials: readonly Material[]): Map<Texture, number> {
  const counts = new Map<Texture, number>();
  for (const material of materials) {
    const texture = material.getMetallicRoughnessTexture();
    if (texture !== null) counts.set(texture, (counts.get(texture) ?? 0) + 1);
  }
  return counts;
}

/** True when a texture has more than one slot or material referencing it. */
function isSharedTexture(texture: Texture): boolean {
  return texture.listParents().filter((parent) => parent.propertyType !== 'Root').length > 1;
}

/**
 * Textures that must be cloned before masking.
 *
 * Snapshot before any material is edited: a shared texture's use count drops as
 * soon as the first material clones it, and then the next material would wrongly
 * see the original as private.
 */
function texturesToClone(materials: readonly Material[]): Set<Texture> {
  const shared = new Set<Texture>();
  for (const [texture, count] of metallicRoughnessUseCounts(materials)) {
    if (count > 1 || isSharedTexture(texture)) shared.add(texture);
  }
  return shared;
}

/** The decoded RGBA image bytes, or a clear error when the texture is empty. */
function requireImage(texture: Texture): Uint8Array {
  const image = texture.getImage();
  if (image === null || image.length === 0) {
    throw new Error('A metallic-roughness texture has no embedded image.');
  }
  return image;
}

/** True when this blue value is below the metal threshold. */
function isWeakMetal(value: number): boolean {
  return value < METAL_MASK_THRESHOLD;
}

/** True for the ambiguous band between non-metal (<= 0.1) and half. */
function isPartlyMetal(value: number): boolean {
  return value > NON_METAL_TENTH_BYTE && value < METAL_MASK_THRESHOLD;
}

/**
 * Zero every weak blue value and re-encode the texture as lossless PNG.
 *
 * Green (roughness) and red/alpha are copied byte for byte; only the blue
 * channel changes. Returns the fraction of texels in the partly-metal band,
 * i.e. the values whose appearance actually changed.
 */
async function maskBlueChannel(texture: Texture, sharpFactory: SharpFactory): Promise<number> {
  const { data, info } = await sharpFactory(Buffer.from(requireImage(texture)))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = new Uint8Array(data);
  let masked = 0;

  for (let index = 2; index < pixels.length; index += 4) {
    const blue = pixels[index];
    if (!isWeakMetal(blue)) continue;
    if (isPartlyMetal(blue)) masked += 1;
    pixels[index] = 0;
  }

  const png = await sharpFactory(Buffer.from(pixels), {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
  texture.setImage(new Uint8Array(png)).setMimeType('image/png');

  return masked / (pixels.length / 4);
}

/**
 * The texture to mask: the original when private, otherwise a clone that keeps
 * the other slot or material reading the original bytes.
 */
function textureForMasking(material: Material, texture: Texture, shared: boolean): Texture {
  if (!shared) return texture;
  const clone = texture.clone();
  material.setMetallicRoughnessTexture(clone);
  return clone;
}

/**
 * Decide one textured material.
 *
 * A shared texture is cloned first, so the masked copy never changes the bytes
 * another slot or material reads.
 */
async function texturedDecision(args: {
  index: number;
  material: Material;
  metalFraction: number;
  texture: Texture;
  shared: boolean;
  sharpFactory: SharpFactory;
}): Promise<MaterialDecision> {
  const { index, material, metalFraction, texture, shared, sharpFactory } = args;
  const name = materialName(material);

  if (material.getMetallicFactor() !== 1) {
    return { index, name, decision: 'unchanged', reason: 'explicit-factor' };
  }

  if (metalFraction < NON_METAL_FRACTION_MAX) {
    material.setMetallicFactor(0);
    return { index, name, decision: 'non-metal', metalFraction };
  }

  material.setMetallicFactor(1);
  const target = textureForMasking(material, texture, shared);
  const maskedFraction = await maskBlueChannel(target, sharpFactory);
  return { index, name, decision: 'metal-masked', metalFraction, maskedFraction };
}

/** True when the texture can supply both channel statistics. */
function hasUsableImage(
  texture: Texture,
  stats: MaterialStats
): stats is MaterialStats & { metal: ChannelStats; roughness: ChannelStats } {
  return (
    DECODABLE_IMAGE_MIME_TYPES.has(texture.getMimeType()) &&
    stats.metal !== null &&
    stats.roughness !== null
  );
}

/** Route one material to the untextured or textured decision. */
async function decideMaterial(args: {
  index: number;
  material: Material;
  stats: MaterialStats | undefined;
  sharedTextures: ReadonlySet<Texture>;
  sharpFactory: SharpFactory;
}): Promise<MaterialDecision> {
  const { index, material, stats, sharedTextures, sharpFactory } = args;
  const texture = material.getMetallicRoughnessTexture();
  if (stats === undefined) {
    return {
      index,
      name: materialName(material),
      decision: 'unchanged',
      reason: 'missing-analysis',
    };
  }
  if (texture === null) {
    return untexturedDecision(index, material);
  }
  if (!hasUsableImage(texture, stats)) {
    return {
      index,
      name: materialName(material),
      decision: 'unchanged',
      reason: 'unsupported-image',
    };
  }
  return texturedDecision({
    index,
    material,
    metalFraction: stats.metal.fractionAtLeastHalf,
    texture,
    shared: sharedTextures.has(texture),
    sharpFactory,
  });
}

/**
 * Set each material's metalness explicitly from its metal channel.
 * Mutates `doc`. Returns one decision per material, in material order.
 */
export async function normaliseMaterials(
  doc: Document,
  analysis: AssetAnalysis
): Promise<MaterialDecision[]> {
  const { default: sharpFactory } = await import('sharp');
  const materials = doc.getRoot().listMaterials();
  const sharedTextures = texturesToClone(materials);
  const decisions: MaterialDecision[] = [];
  for (const [index, material] of materials.entries()) {
    decisions.push(
      await decideMaterial({
        index,
        material,
        stats: analysis.materials[index],
        sharedTextures,
        sharpFactory,
      })
    );
  }
  return decisions;
}
