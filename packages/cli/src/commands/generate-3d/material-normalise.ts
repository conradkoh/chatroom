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
 * the roughness channel survives exactly. A texture used by more than one
 * material, or by a slot of another material, is cloned before masking, so no
 * other material or base-colour output changes.
 */

import type { Document, Material, Texture } from '@gltf-transform/core';

import {
  DECODABLE_IMAGE_MIME_TYPES,
  decodeImageRgba,
  type AssetAnalysis,
  type ChannelStats,
  type MaterialStats,
  type SharpFactory,
} from './asset-analysis.js';

/** A material is non-metal when fewer than this fraction of its texels are metal. */
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
  const { pixels, width, height } = await decodeImageRgba(requireImage(texture), sharpFactory);
  let masked = 0;

  for (let index = 2; index < pixels.length; index += 4) {
    const blue = pixels[index];
    if (!isWeakMetal(blue)) continue;
    if (isPartlyMetal(blue)) masked += 1;
    pixels[index] = 0;
  }

  const png = await sharpFactory(Buffer.from(pixels), {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();
  texture.setImage(new Uint8Array(png)).setMimeType('image/png');

  return masked / (pixels.length / 4);
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

/** True when a usable textured material has enough metal to mask. */
function canMask(texture: Texture, stats: MaterialStats): boolean {
  if (!hasUsableImage(texture, stats)) return false;
  return stats.metal.fractionAtLeastHalf >= NON_METAL_FRACTION_MAX;
}

/** True when this material should be metal-masked. */
function isMaskCandidate(material: Material, stats: MaterialStats | undefined): boolean {
  if (stats === undefined || material.getMetallicFactor() !== 1) return false;
  const texture = material.getMetallicRoughnessTexture();
  if (texture === null) return false;
  return canMask(texture, stats);
}

/** The decision for a textured material that is not masked. */
function texturedNonMaskedDecision(
  index: number,
  material: Material,
  texture: Texture,
  stats: MaterialStats
): MaterialDecision {
  const name = materialName(material);
  if (!hasUsableImage(texture, stats)) {
    return { index, name, decision: 'unchanged', reason: 'unsupported-image' };
  }
  if (material.getMetallicFactor() !== 1) {
    return { index, name, decision: 'unchanged', reason: 'explicit-factor' };
  }
  material.setMetallicFactor(0);
  return {
    index,
    name,
    decision: 'non-metal',
    metalFraction: stats.metal.fractionAtLeastHalf,
  };
}

/** The decisions for materials that are not metal-masked. */
function nonMaskedDecision(
  index: number,
  material: Material,
  stats: MaterialStats | undefined
): MaterialDecision {
  if (stats === undefined) {
    return {
      index,
      name: materialName(material),
      decision: 'unchanged',
      reason: 'missing-analysis',
    };
  }
  const texture = material.getMetallicRoughnessTexture();
  if (texture === null) return untexturedDecision(index, material);
  return texturedNonMaskedDecision(index, material, texture, stats);
}

/** Every material whose metallic-roughness slot is this texture. */
function textureUsers(materials: readonly Material[], texture: Texture): number[] {
  const users: number[] = [];
  for (const [index, material] of materials.entries()) {
    if (material.getMetallicRoughnessTexture() === texture) users.push(index);
  }
  return users;
}

/** True when a masked clone is needed to leave another user on the original. */
function needsClone(
  texture: Texture,
  users: readonly number[],
  masked: readonly number[]
): boolean {
  const parents = texture.listParents().filter((parent) => parent.propertyType !== 'Root').length;
  return users.length > masked.length || parents > users.length;
}

/** One material that will be metal-masked, with its analysis fraction. */
interface MaskedUser {
  index: number;
  material: Material;
  metalFraction: number;
}

/** Build the masked user for one material, or null when it is not a candidate. */
function maskedUserFor(
  index: number,
  material: Material,
  stats: MaterialStats | undefined
): MaskedUser | null {
  if (!isMaskCandidate(material, stats)) return null;
  if (stats === undefined || stats.metal === null) return null;
  return { index, material, metalFraction: stats.metal.fractionAtLeastHalf };
}

/** Mask one texture once and apply the shared result to all its masked users. */
async function maskTextureGroup(args: {
  texture: Texture;
  masked: readonly MaskedUser[];
  users: readonly number[];
  sharpFactory: SharpFactory;
  decisions: Map<number, MaterialDecision>;
}): Promise<void> {
  const { texture, masked, users, sharpFactory, decisions } = args;
  const clone = needsClone(
    texture,
    users,
    masked.map((user) => user.index)
  );
  const target = clone ? texture.clone() : texture;
  const maskedFraction = await maskBlueChannel(target, sharpFactory);

  for (const user of masked) {
    user.material.setMetallicFactor(1);
    if (clone) user.material.setMetallicRoughnessTexture(target);
    decisions.set(user.index, {
      index: user.index,
      name: materialName(user.material),
      decision: 'metal-masked',
      metalFraction: user.metalFraction,
      maskedFraction,
    });
  }
}

/** One material's candidate texture and user record, when it is a candidate. */
function maskedEntryFor(
  index: number,
  material: Material,
  stats: MaterialStats | undefined
): { texture: Texture; user: MaskedUser } | null {
  const user = maskedUserFor(index, material, stats);
  if (user === null) return null;
  const texture = material.getMetallicRoughnessTexture();
  return texture === null ? null : { texture, user };
}

/** Group the mask candidates by their shared metallic-roughness texture. */
function maskedGroups(
  materials: readonly Material[],
  analysis: AssetAnalysis
): Map<Texture, MaskedUser[]> {
  const groups = new Map<Texture, MaskedUser[]>();
  for (const [index, material] of materials.entries()) {
    const entry = maskedEntryFor(index, material, analysis.materials[index]);
    if (entry === null) continue;
    const group = groups.get(entry.texture) ?? [];
    group.push(entry.user);
    groups.set(entry.texture, group);
  }
  return groups;
}

/** Fill decisions for every material that was not masked. */
function fillNonMasked(
  materials: readonly Material[],
  analysis: AssetAnalysis,
  decisions: Map<number, MaterialDecision>
): void {
  for (const [index, material] of materials.entries()) {
    if (decisions.has(index)) continue;
    decisions.set(index, nonMaskedDecision(index, material, analysis.materials[index]));
  }
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
  const decisions = new Map<number, MaterialDecision>();

  for (const [texture, masked] of maskedGroups(materials, analysis)) {
    await maskTextureGroup({
      texture,
      masked,
      users: textureUsers(materials, texture),
      sharpFactory,
      decisions,
    });
  }
  fillNonMasked(materials, analysis, decisions);

  return materials.map(
    (_material, index) =>
      decisions.get(index) ?? {
        index,
        name: null,
        decision: 'unchanged',
        reason: 'missing-analysis',
      }
  );
}
