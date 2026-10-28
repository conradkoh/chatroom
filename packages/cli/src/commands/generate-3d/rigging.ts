/**
 * Generate 3D — pure rigging logic for `chatroom generate-3d --rig`.
 *
 * Meshy's fal rigging endpoints take the public URL of the generated mesh and
 * return a rigged character, optional preset animation clips, and FBX variants.
 * This module owns everything that can be decided without a network call:
 * validating the requested clip ids, choosing the endpoint, building the
 * request body, narrowing the result, and listing the extra cost.
 *
 * No SDK, network, clock, or filesystem access is imported here. The two paid
 * calls themselves arrive through `Generate3dDeps`.
 */

import { fileUrl, Generate3dError, isRecord } from './model-registry.js';

/** Rig-only endpoint: returns the rigged character and basic animations. */
// fallow-ignore-next-line unused-export
export const RIGGING_ENDPOINT = 'fal-ai/meshy/rigging';

/** Endpoint used when one or more preset animation clips are requested. */
// fallow-ignore-next-line unused-export
export const RIGGING_MULTI_ANIMATION_ENDPOINT = 'fal-ai/meshy/rigging/multi-animation';

/**
 * Meshy accepts animation preset ids in `[0, 696]`. The research found no
 * published name map, so the CLI takes ids only.
 */
// fallow-ignore-next-line unused-export
export const MESHY_ANIMATION_ACTION_ID_MAX = 696;

/** List price of one rigging request, in USD. */
// fallow-ignore-next-line unused-export
export const RIGGING_BASE_USD = 0.2;

/** List price of each additional animation clip, in USD. */
// fallow-ignore-next-line unused-export
export const RIGGING_PER_CLIP_USD = 0.12;

const RIGGING_RESULT_PREFIX = 'fal returned an unexpected rigging result: ';

function invalidResult(reason: string): Generate3dError {
  return new Generate3dError(`${RIGGING_RESULT_PREFIX}${reason}`);
}

function invalidAnimationActionId(raw: string): Generate3dError {
  return new Generate3dError(
    `--animation-action-id must be an integer from 0 to ${MESHY_ANIMATION_ACTION_ID_MAX}; got "${raw}".`
  );
}

/** A Meshy preset id: a safe integer inside the published range. */
function isMeshyAnimationActionId(id: number): boolean {
  return Number.isSafeInteger(id) && id >= 0 && id <= MESHY_ANIMATION_ACTION_ID_MAX;
}

/** One raw value → a safe integer in the Meshy preset range. */
function parseAnimationActionId(raw: string): number {
  const text = raw.trim();
  const id = Number(text);
  if (text.length === 0 || !isMeshyAnimationActionId(id)) {
    throw invalidAnimationActionId(raw);
  }
  return id;
}

/**
 * Validate the raw `--animation-action-id` values, preserving the order given.
 *
 * Values arrive as strings because commander only parses the flag; conversion
 * happens here so every invalid value fails with a `Generate3dError` before the
 * paid mesh call. Empty input means "no clips".
 */
export function parseAnimationActionIds(values: readonly string[]): number[] {
  const ids = values.map(parseAnimationActionId);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate !== undefined) {
    throw new Generate3dError(`Duplicate --animation-action-id ${duplicate}.`);
  }
  return ids;
}

/** The endpoint and exact body for one rigging call. */
export interface RiggingRequest {
  endpoint: string;
  input: Record<string, unknown>;
}

/**
 * Rigging takes the public URL of the already-generated mesh, so the mesh is
 * not re-uploaded. Clip ids switch the call to the multi-animation endpoint;
 * the request sends nothing else (no height, no safety-checker override).
 */
export function buildRiggingRequest(args: {
  modelGlbUrl: string;
  animationActionIds: readonly number[];
}): RiggingRequest {
  const modelGlbUrl = args.modelGlbUrl.trim();
  if (modelGlbUrl.length === 0) {
    throw new Generate3dError('Rigging requires the generated mesh GLB URL.');
  }
  if (args.animationActionIds.length === 0) {
    return { endpoint: RIGGING_ENDPOINT, input: { model_url: modelGlbUrl } };
  }
  return {
    endpoint: RIGGING_MULTI_ANIMATION_ENDPOINT,
    input: {
      model_url: modelGlbUrl,
      animation_action_ids: [...args.animationActionIds],
    },
  };
}

/** The rigged files and clips the manifest records. */
export interface RiggingOutput {
  riggedGlbUrl: string;
  riggedFbxUrl: string | null;
  /** Every fal `File` URL in `basic_animations`, keyed by field name. */
  basicAnimationUrls: Record<string, string>;
  animations: { actionId: number; glbUrl: string }[];
}

/** One `[name, url]` pair, or none when the entry is not a fal File. */
function basicAnimationEntry([name, entry]: [string, unknown]): [string, string][] {
  const url = fileUrl(entry);
  return url === undefined ? [] : [[name, url]];
}

/**
 * Flatten `basic_animations` (walking/running GLB and FBX variants) into a
 * stable name → URL map. These files are recorded in the manifest only; the
 * command never downloads them.
 */
function readBasicAnimationUrls(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw invalidResult('basic_animations is not an object');
  }
  return Object.fromEntries(Object.entries(value).flatMap(basicAnimationEntry));
}

/**
 * The multi-animation endpoint returns clips in the requested order. A
 * different order, count, or id would silently attach the wrong preset, so it
 * is rejected instead of written.
 */
function readAnimations(
  value: unknown,
  animationActionIds: readonly number[]
): { actionId: number; glbUrl: string }[] {
  if (!Array.isArray(value)) {
    throw invalidResult('animations is missing or not an array');
  }
  if (value.length !== animationActionIds.length) {
    throw invalidResult(
      `expected ${animationActionIds.length} animation clip(s), got ${value.length}`
    );
  }
  return value.map((entry, index) => {
    const expected = animationActionIds[index] as number;
    if (!isRecord(entry)) {
      throw invalidResult(`animation clip ${index} is not an object`);
    }
    const actionId = entry.action_id;
    if (actionId !== expected) {
      throw invalidResult(
        `animation clip ${index} has action_id ${String(actionId)}, expected ${expected}`
      );
    }
    const glbUrl = fileUrl(entry.animation_glb);
    if (glbUrl === undefined) {
      throw invalidResult(`animation clip ${expected} is missing animation_glb.url`);
    }
    return { actionId: expected, glbUrl };
  });
}

/**
 * A rig without clips has no animation files even if fal returns extras; a
 * multi-animation rig is checked against the requested ids.
 */
function readRequestedAnimations(
  value: unknown,
  animationActionIds: readonly number[]
): { actionId: number; glbUrl: string }[] {
  return animationActionIds.length === 0 ? [] : readAnimations(value, animationActionIds);
}

/**
 * Narrow the raw fal `data` for either rigging endpoint.
 */
export function readRiggingOutput(
  data: unknown,
  args: { animationActionIds: readonly number[] }
): RiggingOutput {
  if (!isRecord(data)) throw invalidResult('data is not an object');
  const riggedGlbUrl = fileUrl(data.rigged_character_glb);
  if (riggedGlbUrl === undefined) {
    throw invalidResult('rigged_character_glb.url is missing');
  }
  return {
    riggedGlbUrl,
    riggedFbxUrl: fileUrl(data.rigged_character_fbx) ?? null,
    basicAnimationUrls: readBasicAnimationUrls(data.basic_animations),
    animations: readRequestedAnimations(data.animations, args.animationActionIds),
  };
}

/** One line of the static rigging cost estimate. */
export interface RiggingCostLine {
  label: string;
  usd: number;
}

/**
 * The extra list price of a rig run: a flat request fee plus one fee per
 * requested clip. With no clips there is no clip line, matching the endpoint
 * choice in `buildRiggingRequest`.
 */
export function riggingCostLines(animationCount: number): RiggingCostLine[] {
  const lines: RiggingCostLine[] = [
    { label: `rigging (Meshy) $${RIGGING_BASE_USD.toFixed(2)}`, usd: RIGGING_BASE_USD },
  ];
  if (animationCount > 0) {
    const clipsUsd = RIGGING_PER_CLIP_USD * animationCount;
    lines.push({
      label: `animation clips (${animationCount}) $${RIGGING_PER_CLIP_USD.toFixed(2)} each = $${clipsUsd.toFixed(2)}`,
      usd: clipsUsd,
    });
  }
  return lines;
}
