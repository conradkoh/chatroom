/**
 * Asset-check tests.
 *
 * The analysis is a plain object, so each test states exactly the numbers a
 * check sees; no GLB or decoder is involved.
 */

import { describe, expect, it } from 'vitest';

import type { AssetAnalysis, ChannelStats, MaterialStats } from './asset-analysis.js';
import { computeChecks, type CheckId } from './checks.js';

/** A channel distribution with every statistic equal to `value`. */
function channel(value: number): ChannelStats {
  return {
    mean: value,
    p5: value,
    p50: value,
    p95: value,
    fractionAtLeastHalf: value,
    fractionAtMostTenth: value,
  };
}

/** One material; defaults to a metal texture with half metal texels. */
function material(overrides: Partial<MaterialStats> = {}): MaterialStats {
  return {
    index: 0,
    name: null,
    metallicFactor: 1,
    roughnessFactor: 1,
    hasMetallicRoughnessTexture: true,
    metal: channel(0.5),
    roughness: channel(0.5),
    ...overrides,
  };
}

/** An analysis with a unit-height model on its feet unless overridden. */
function analysis(overrides: Partial<AssetAnalysis> = {}): AssetAnalysis {
  return {
    bounds: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] },
    extents: [1, 1, 1],
    materials: [],
    ...overrides,
  };
}

/** The check ids in their returned order. */
function ids(checks: ReturnType<typeof computeChecks>): CheckId[] {
  return checks.map((check) => check.id);
}

describe('computeChecks', () => {
  it('warns when a metal texture is metal across the whole surface', () => {
    const checks = computeChecks(analysis({ materials: [material({ metal: channel(0.9) })] }));

    expect(ids(checks)).toEqual(['metal-whole-texture']);
    expect(checks[0]).toMatchObject({ materialIndex: 0, severity: 'warning' });
  });

  it('does not warn for a partly metal texture', () => {
    const checks = computeChecks(analysis({ materials: [material({ metal: channel(0.24) })] }));

    expect(ids(checks)).not.toContain('metal-whole-texture');
  });

  it('warns for an untextured factor of 1 and not for 0.4', () => {
    const textured = (metallicFactor: number) =>
      material({
        metallicFactor,
        metal: null,
        hasMetallicRoughnessTexture: false,
        roughness: null,
      });

    expect(ids(computeChecks(analysis({ materials: [textured(1)] })))).toContain(
      'metal-whole-texture'
    );
    expect(ids(computeChecks(analysis({ materials: [textured(0.4)] })))).not.toContain(
      'metal-whole-texture'
    );
  });

  it('warns for a flat model', () => {
    const checks = computeChecks(analysis({ extents: [1, 0.001, 1] }));

    expect(ids(checks)).toContain('flat');
    expect(checks.find((check) => check.id === 'flat')?.materialIndex).toBeNull();
  });

  it('warns when the model is centred instead of on its feet', () => {
    const centred = computeChecks(
      analysis({ bounds: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] } })
    );
    const onFeet = computeChecks(analysis());

    expect(ids(centred)).toContain('not-on-feet');
    expect(ids(onFeet)).not.toContain('not-on-feet');
  });

  it('warns for a non-metal with low roughness but not for a rough or metal one', () => {
    const glossy = computeChecks(
      analysis({
        materials: [material({ metal: channel(0), roughness: channel(0.24) })],
      })
    );
    const rough = computeChecks(
      analysis({
        materials: [material({ metal: channel(0), roughness: channel(0.6) })],
      })
    );
    const metal = computeChecks(
      analysis({
        materials: [material({ metal: channel(0.9), roughness: channel(0.2) })],
      })
    );

    expect(ids(glossy)).toContain('glossy-non-metal');
    expect(glossy.find((check) => check.id === 'glossy-non-metal')?.message).toContain('mean 0.24');
    expect(ids(rough)).not.toContain('glossy-non-metal');
    expect(ids(metal)).not.toContain('glossy-non-metal');
  });

  it('combines roughness factor with the textured mean for glossy non-metal', () => {
    const glossy = computeChecks(
      analysis({
        materials: [
          material({
            metal: channel(0),
            roughness: channel(0.5),
            roughnessFactor: 0.5,
          }),
        ],
      })
    );
    const rough = computeChecks(
      analysis({
        materials: [
          material({
            metal: channel(0),
            roughness: channel(0.5),
            roughnessFactor: 1,
          }),
        ],
      })
    );

    expect(ids(glossy)).toContain('glossy-non-metal');
    expect(glossy.find((check) => check.id === 'glossy-non-metal')?.message).toContain('mean 0.25');
    expect(ids(rough)).not.toContain('glossy-non-metal');
  });

  it('checks the roughness factor directly for an untextured non-metal', () => {
    const untextured = (roughnessFactor: number) =>
      material({
        metallicFactor: 0,
        metal: null,
        roughness: null,
        hasMetallicRoughnessTexture: false,
        roughnessFactor,
      });

    const glossy = computeChecks(analysis({ materials: [untextured(0.2)] }));
    const rough = computeChecks(analysis({ materials: [untextured(0.8)] }));

    expect(ids(glossy)).toContain('glossy-non-metal');
    expect(glossy.find((check) => check.id === 'glossy-non-metal')?.message).toContain(
      'factor 0.20'
    );
    expect(ids(rough)).not.toContain('glossy-non-metal');
  });

  it('puts model checks before material checks in material order', () => {
    const checks = computeChecks(
      analysis({
        extents: [1, 0.001, 1],
        bounds: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
        materials: [
          material({
            index: 0,
            metal: channel(0),
            roughness: channel(0.2),
          }),
          material({
            index: 1,
            metal: channel(0.9),
            roughness: channel(0.5),
          }),
        ],
      })
    );

    expect(ids(checks)).toEqual(['flat', 'not-on-feet', 'glossy-non-metal', 'metal-whole-texture']);
    expect(checks.map((check) => check.materialIndex)).toEqual([null, null, 0, 1]);
  });
});
