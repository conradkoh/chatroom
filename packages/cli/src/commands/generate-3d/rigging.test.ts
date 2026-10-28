/**
 * Rigging unit tests.
 *
 * Covers the pure rigging helpers: endpoint and body choice, result narrowing,
 * and the static cost line. No network or fal call.
 */

import { describe, expect, it } from 'vitest';

import {
  buildRiggingRequest,
  readRiggingOutput,
  RIGGING_BASE_USD,
  RIGGING_ENDPOINT,
  riggingCostLines,
} from './rigging.js';

const MODEL_URL = 'https://fal.test/generated/hero.glb';
const RIGGED_GLB_URL = 'https://fal.test/rigged/hero.rigged.glb';
const RIGGED_FBX_URL = 'https://fal.test/rigged/hero.rigged.fbx';

function riggingFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    rigged_character_glb: { url: RIGGED_GLB_URL },
    rigged_character_fbx: { url: RIGGED_FBX_URL },
    basic_animations: {
      walking_glb: { url: 'https://fal.test/basic/walking.glb' },
      running_glb: { url: 'https://fal.test/basic/running.glb' },
      walking_fbx: { url: 'https://fal.test/basic/walking.fbx' },
    },
    rig_task_id: 'rig-456',
    ...overrides,
  };
}

describe('buildRiggingRequest', () => {
  it('uses the rig endpoint with exactly model_url', () => {
    expect(buildRiggingRequest({ modelGlbUrl: MODEL_URL })).toEqual({
      endpoint: RIGGING_ENDPOINT,
      input: { model_url: MODEL_URL },
    });
  });

  it('rejects an empty mesh URL', () => {
    expect(() => buildRiggingRequest({ modelGlbUrl: '  ' })).toThrow(
      /requires the generated mesh GLB URL/
    );
  });
});

describe('readRiggingOutput', () => {
  it('narrows the result and records basic animation URLs', () => {
    const output = readRiggingOutput(riggingFixture());

    expect(output).toEqual({
      riggedGlbUrl: RIGGED_GLB_URL,
      riggedFbxUrl: RIGGED_FBX_URL,
      basicAnimationUrls: {
        walking_glb: 'https://fal.test/basic/walking.glb',
        running_glb: 'https://fal.test/basic/running.glb',
        walking_fbx: 'https://fal.test/basic/walking.fbx',
      },
    });
  });

  it('rejects a result without rigged_character_glb.url', () => {
    expect(() => readRiggingOutput({ rigged_character_glb: {} })).toThrow(
      /rigged_character_glb\.url is missing/
    );
  });
});

describe('riggingCostLines', () => {
  it('lists the rig fee', () => {
    expect(riggingCostLines()).toEqual([{ label: 'rigging (Meshy) $0.20', usd: RIGGING_BASE_USD }]);
  });
});
