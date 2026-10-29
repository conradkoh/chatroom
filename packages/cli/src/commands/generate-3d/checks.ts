/**
 * Generate 3D — advisory checks for a finished asset.
 *
 * The checks are computed from the written GLB's analysis, not from the model's
 * request, so a rebuild of an old package produces the same warnings as a fresh
 * run. Every check is a warning: nothing here fails a generation or edits the
 * asset. Fit and roughness stay user decisions.
 *
 * Order is fixed: model-level checks first, then materials in material order.
 */

import type { AssetAnalysis, ChannelStats } from './asset-analysis.js';
import { NON_METAL_FRACTION_MAX } from './material-normalise.js';

export type CheckId = 'metal-whole-texture' | 'flat' | 'not-on-feet' | 'glossy-non-metal';

export interface AssetCheck {
  id: CheckId;
  /** 'warning' for every check in this slice. */
  severity: 'warning';
  /** Material index the check refers to, or null for a whole-model check. */
  materialIndex: number | null;
  message: string;
}

/** Tuned thresholds. Exported so tests and docs can cite them. */
// fallow-ignore-next-line unused-export
export const CHECK_THRESHOLDS = {
  /** metal-whole-texture: factor > 0 and at least this share of texels are metal (>= 0.5). */
  wholeTextureMetalFraction: 0.5,
  /** flat: smallest extent / largest extent below this. */
  flatRatio: 0.05,
  /** not-on-feet: |min.y| above this share of the height. */
  feetShare: 0.01,
  /** glossy-non-metal: non-metal (metal fraction below 0.01) with roughness mean below this. */
  glossyRoughnessMean: 0.35,
} as const;

/** A non-metal material is below half metal when it has no texture. */
const NON_METAL_FACTOR_MAX = 0.5;

/** `2` for messages that quote the roughness mean. */
function formatMean(mean: number): string {
  return mean.toFixed(2);
}

/** True when the material's factor and map agree that it is all metal. */
function isWholeTextureMetal(material: AssetAnalysis['materials'][number]): boolean {
  if (material.metal === null) {
    return (
      !material.hasMetallicRoughnessTexture &&
      material.metallicFactor >= CHECK_THRESHOLDS.wholeTextureMetalFraction
    );
  }
  return (
    material.metallicFactor > 0 &&
    material.metal.fractionAtLeastHalf >= CHECK_THRESHOLDS.wholeTextureMetalFraction
  );
}

/** `metal-whole-texture` for one material, when its factor and map agree it is all metal. */
function metalWholeTextureFor(material: AssetAnalysis['materials'][number]): AssetCheck | null {
  if (!isWholeTextureMetal(material)) return null;
  return {
    id: 'metal-whole-texture',
    severity: 'warning',
    materialIndex: material.index,
    message: `Material ${material.index} looks metal across its whole surface; check that the surface really is metal.`,
  };
}

/** `flat` when the model's smallest extent is a tiny slice of its largest. */
function flatChecks(analysis: AssetAnalysis): AssetCheck[] {
  const largest = Math.max(...analysis.extents);
  if (largest <= 0) return [];
  const ratio = Math.min(...analysis.extents) / largest;
  if (ratio >= CHECK_THRESHOLDS.flatRatio) return [];
  return [
    {
      id: 'flat',
      severity: 'warning',
      materialIndex: null,
      message:
        'Model is flat (thickness is under 5% of its width); a flat model may disappear from some angles.',
    },
  ];
}

/** `not-on-feet` when the base sits away from y = 0 by more than 1% of the height. */
function feetChecks(analysis: AssetAnalysis): AssetCheck[] {
  const height = analysis.bounds.max[1] - analysis.bounds.min[1];
  const offset = Math.abs(analysis.bounds.min[1]);
  if (offset <= CHECK_THRESHOLDS.feetShare * height) return [];
  return [
    {
      id: 'not-on-feet',
      severity: 'warning',
      materialIndex: null,
      message: `Model's base is not at the origin. Use --origin feet to move the base to the origin.`,
    },
  ];
}

/** The effective roughness and the label the check should quote. */
interface GlossyValue {
  value: number;
  label: 'mean' | 'factor';
}

/** A material with both metallic-roughness channel distributions. */
type TexturedMaterial = AssetAnalysis['materials'][number] & {
  metal: ChannelStats;
  roughness: ChannelStats;
};

/** True when the analysis produced both channel distributions. */
function hasChannels(material: AssetAnalysis['materials'][number]): material is TexturedMaterial {
  return material.metal !== null && material.roughness !== null;
}

/** The textured branch: effective roughness from the map and the factor. */
function texturedGlossy(material: AssetAnalysis['materials'][number]): GlossyValue | null {
  if (!hasChannels(material)) return null;
  if (material.metal.fractionAtLeastHalf >= NON_METAL_FRACTION_MAX) return null;
  const value = material.roughness.mean * material.roughnessFactor;
  return value < CHECK_THRESHOLDS.glossyRoughnessMean ? { value, label: 'mean' } : null;
}

/** The untextured branch: the factor itself is the roughness. */
function untexturedGlossy(material: AssetAnalysis['materials'][number]): GlossyValue | null {
  if (material.metallicFactor >= NON_METAL_FACTOR_MAX) return null;
  return material.roughnessFactor < CHECK_THRESHOLDS.glossyRoughnessMean
    ? { value: material.roughnessFactor, label: 'factor' }
    : null;
}

/** The value to compare for `glossy-non-metal`, or null when it does not apply. */
function glossyValue(material: AssetAnalysis['materials'][number]): GlossyValue | null {
  return material.hasMetallicRoughnessTexture
    ? texturedGlossy(material)
    : untexturedGlossy(material);
}

/** `glossy-non-metal` for one non-metal material with low roughness. */
function glossyFor(material: AssetAnalysis['materials'][number]): AssetCheck | null {
  const glossy = glossyValue(material);
  if (glossy === null) return null;
  return {
    id: 'glossy-non-metal',
    severity: 'warning',
    materialIndex: material.index,
    message: `Material ${material.index} is non-metal with low roughness (${glossy.label} ${formatMean(glossy.value)}); it may look glossy or metallic under light.`,
  };
}

/**
 * Compute every warning for a finished asset.
 *
 * Model checks come first, then each material's checks in document order.
 */
export function computeChecks(analysis: AssetAnalysis): AssetCheck[] {
  const checks = [...flatChecks(analysis), ...feetChecks(analysis)];
  for (const material of analysis.materials) {
    const metal = metalWholeTextureFor(material);
    if (metal !== null) checks.push(metal);
    const glossy = glossyFor(material);
    if (glossy !== null) checks.push(glossy);
  }
  return checks;
}
