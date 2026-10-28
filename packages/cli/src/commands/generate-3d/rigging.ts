/**
 * Generate 3D — pure rigging logic for `chatroom generate-3d --rig`.
 *
 * Meshy's fal rigging endpoint takes the public URL of the generated mesh and
 * returns a rigged character plus FBX and basic animation variants. This module
 * owns everything that can be decided without a network call: choosing the
 * endpoint, building the request body, narrowing the result, and listing the
 * extra cost.
 *
 * No SDK, network, clock, or filesystem access is imported here. The paid call
 * itself arrives through `Generate3dDeps`.
 */

import { fileUrl, Generate3dError, isRecord } from './model-registry.js';

/** Rig endpoint: returns the rigged character and basic animations. */
// fallow-ignore-next-line unused-export
export const RIGGING_ENDPOINT = 'fal-ai/meshy/rigging';

/** List price of one rigging request, in USD. */
// fallow-ignore-next-line unused-export
export const RIGGING_BASE_USD = 0.2;

const RIGGING_RESULT_PREFIX = 'fal returned an unexpected rigging result: ';

function invalidResult(reason: string): Generate3dError {
  return new Generate3dError(`${RIGGING_RESULT_PREFIX}${reason}`);
}

/** The endpoint and exact body for one rigging call. */
export interface RiggingRequest {
  endpoint: string;
  input: Record<string, unknown>;
}

/**
 * Rigging takes the public URL of the already-generated mesh, so the mesh is
 * not re-uploaded. The request sends nothing else (no height, no
 * safety-checker override).
 */
export function buildRiggingRequest(args: { modelGlbUrl: string }): RiggingRequest {
  const modelGlbUrl = args.modelGlbUrl.trim();
  if (modelGlbUrl.length === 0) {
    throw new Generate3dError('Rigging requires the generated mesh GLB URL.');
  }
  return { endpoint: RIGGING_ENDPOINT, input: { model_url: modelGlbUrl } };
}

/** The rigged files the manifest records. */
export interface RiggingOutput {
  riggedGlbUrl: string;
  riggedFbxUrl: string | null;
  /** Every fal `File` URL in `basic_animations`, keyed by field name. */
  basicAnimationUrls: Record<string, string>;
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

/** Narrow the raw fal `data` for the rigging endpoint. */
export function readRiggingOutput(data: unknown): RiggingOutput {
  if (!isRecord(data)) throw invalidResult('data is not an object');
  const riggedGlbUrl = fileUrl(data.rigged_character_glb);
  if (riggedGlbUrl === undefined) {
    throw invalidResult('rigged_character_glb.url is missing');
  }
  return {
    riggedGlbUrl,
    riggedFbxUrl: fileUrl(data.rigged_character_fbx) ?? null,
    basicAnimationUrls: readBasicAnimationUrls(data.basic_animations),
  };
}

/** One line of the static rigging cost estimate. */
export interface RiggingCostLine {
  label: string;
  usd: number;
}

/** The extra list price of one rig run. */
export function riggingCostLines(): RiggingCostLine[] {
  return [{ label: `rigging (Meshy) $${RIGGING_BASE_USD.toFixed(2)}`, usd: RIGGING_BASE_USD }];
}
