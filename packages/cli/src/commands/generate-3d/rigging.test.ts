/**
 * Rigging unit tests.
 *
 * Covers the pure rigging helpers: clip-id validation, endpoint and body
 * choice, result narrowing, and the static cost lines. No network or fal call.
 */

import { describe, expect, it } from 'vitest';

import {
  buildRiggingRequest,
  MESHY_ANIMATION_ACTION_ID_MAX,
  parseAnimationActionIds,
  readRiggingOutput,
  RIGGING_BASE_USD,
  RIGGING_ENDPOINT,
  RIGGING_MULTI_ANIMATION_ENDPOINT,
  RIGGING_PER_CLIP_USD,
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

describe('parseAnimationActionIds', () => {
  it('parses valid ids and preserves the given order', () => {
    expect(parseAnimationActionIds(['92', '0', '696'])).toEqual([92, 0, 696]);
    expect(parseAnimationActionIds([])).toEqual([]);
    expect(MESHY_ANIMATION_ACTION_ID_MAX).toBe(696);
  });

  it('rejects an out-of-range id', () => {
    expect(() => parseAnimationActionIds(['697'])).toThrow(/integer from 0 to 696.*"697"/);
    expect(() => parseAnimationActionIds(['-1'])).toThrow(/integer from 0 to 696.*"-1"/);
  });

  it('rejects a value that is not an integer', () => {
    expect(() => parseAnimationActionIds(['1.5'])).toThrow(/integer from 0 to 696/);
    expect(() => parseAnimationActionIds(['walk'])).toThrow(/integer from 0 to 696/);
    expect(() => parseAnimationActionIds([''])).toThrow(/integer from 0 to 696/);
  });

  it('rejects duplicates', () => {
    expect(() => parseAnimationActionIds(['5', '5'])).toThrow(/Duplicate --animation-action-id 5/);
    expect(() => parseAnimationActionIds(['5', '05'])).toThrow(/Duplicate --animation-action-id 5/);
  });
});

describe('buildRiggingRequest', () => {
  it('uses the rig-only endpoint with exactly model_url when there are no clips', () => {
    expect(buildRiggingRequest({ modelGlbUrl: MODEL_URL, animationActionIds: [] })).toEqual({
      endpoint: RIGGING_ENDPOINT,
      input: { model_url: MODEL_URL },
    });
  });

  it('uses the multi-animation endpoint with ordered ids when clips are requested', () => {
    expect(buildRiggingRequest({ modelGlbUrl: MODEL_URL, animationActionIds: [0, 92] })).toEqual({
      endpoint: RIGGING_MULTI_ANIMATION_ENDPOINT,
      input: { model_url: MODEL_URL, animation_action_ids: [0, 92] },
    });
  });

  it('rejects an empty mesh URL', () => {
    expect(() => buildRiggingRequest({ modelGlbUrl: '  ', animationActionIds: [] })).toThrow(
      /requires the generated mesh GLB URL/
    );
  });
});

describe('readRiggingOutput', () => {
  it('narrows the rig-only result and records basic animation URLs', () => {
    const output = readRiggingOutput(riggingFixture(), { animationActionIds: [] });

    expect(output).toEqual({
      riggedGlbUrl: RIGGED_GLB_URL,
      riggedFbxUrl: RIGGED_FBX_URL,
      basicAnimationUrls: {
        walking_glb: 'https://fal.test/basic/walking.glb',
        running_glb: 'https://fal.test/basic/running.glb',
        walking_fbx: 'https://fal.test/basic/walking.fbx',
      },
      animations: [],
    });
  });

  it('narrows the multi-animation result in the requested order', () => {
    const output = readRiggingOutput(
      riggingFixture({
        animations: [
          { action_id: 0, animation_glb: { url: 'https://fal.test/anim/0.glb' } },
          { action_id: 92, animation_glb: { url: 'https://fal.test/anim/92.glb' } },
        ],
      }),
      { animationActionIds: [0, 92] }
    );

    expect(output.animations).toEqual([
      { actionId: 0, glbUrl: 'https://fal.test/anim/0.glb' },
      { actionId: 92, glbUrl: 'https://fal.test/anim/92.glb' },
    ]);
  });

  it('rejects a result without rigged_character_glb.url', () => {
    expect(() =>
      readRiggingOutput({ rigged_character_glb: {} }, { animationActionIds: [] })
    ).toThrow(/rigged_character_glb\.url is missing/);
  });

  it('rejects a clip whose action_id does not match the request', () => {
    expect(() =>
      readRiggingOutput(
        riggingFixture({
          animations: [{ action_id: 92, animation_glb: { url: 'https://fal.test/anim/92.glb' } }],
        }),
        { animationActionIds: [0] }
      )
    ).toThrow(/action_id 92, expected 0/);
  });

  it('rejects a clip without animation_glb.url', () => {
    expect(() =>
      readRiggingOutput(riggingFixture({ animations: [{ action_id: 0, animation_glb: {} }] }), {
        animationActionIds: [0],
      })
    ).toThrow(/animation clip 0 is missing animation_glb\.url/);
  });

  it('rejects a clip count that differs from the request', () => {
    expect(() =>
      readRiggingOutput(riggingFixture({ animations: [] }), { animationActionIds: [0] })
    ).toThrow(/expected 1 animation clip\(s\), got 0/);
  });
});

describe('riggingCostLines', () => {
  it('lists only the rig fee with no clips', () => {
    expect(riggingCostLines(0)).toEqual([
      { label: 'rigging (Meshy) $0.20', usd: RIGGING_BASE_USD },
    ]);
  });

  it('adds one per-clip line for three clips', () => {
    const lines = riggingCostLines(3);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ label: 'rigging (Meshy) $0.20', usd: RIGGING_BASE_USD });
    expect(lines[1]?.label).toBe('animation clips (3) $0.12 each = $0.36');
    expect(lines[1]?.usd).toBeCloseTo(RIGGING_PER_CLIP_USD * 3);
  });
});
