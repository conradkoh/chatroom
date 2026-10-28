/**
 * Generate 3D — pure logic for `chatroom generate-3d`.
 *
 * Generates one GLB mesh through an injected fal subscriber, writes the bytes
 * to `out`, and writes a JSON sidecar manifest to `<out>.json`. With `--rig`
 * it then calls Meshy's rigging endpoint, writes `<stem>.rigged.glb`, and
 * rewrites the manifest with a `rigging` section.
 *
 * The mesh is written before the rigging call, so a rig failure never discards
 * a paid generation. No SDK, network, clock, or filesystem access is imported
 * here; all of it arrives through `Generate3dDeps`, so the unit tests run fully
 * offline.
 */

import { createHash } from 'node:crypto';
import { extname, resolve } from 'node:path';

import type { Generate3dDeps } from './deps.js';
import {
  allowedGenerate3dModelIds,
  findGenerate3dModel,
  Generate3dError,
  GENERATE_3D_PRICES_AS_OF,
  type Generate3dCostLine,
  type Generate3dModelSpec,
} from './model-registry.js';
import {
  buildRiggingRequest,
  readRiggingOutput,
  riggingCostLines,
  type RiggingOutput,
  type RiggingRequest,
} from './rigging.js';
import { FAL_API_KEY_MISSING_MESSAGE } from '../generate-image/image.js';

// The error type is exported from this module for callers that only import the
// orchestration layer; the registry remains its definition.
// fallow-ignore-next-line unused-export
export { Generate3dError } from './model-registry.js';

/** Only fal is wired for 3D generation today. */
export type Generate3dPlatform = 'fal';

export interface Generate3dOptions {
  /** Text prompt for a text-to-3D model. */
  prompt?: string | undefined;
  /** Local image path or public http(s) URL for an image-to-3D model. */
  inputImage?: string | undefined;
  /** Allowlisted fal model id. */
  model: string;
  /** Output GLB path; the manifest is written to `<out>.json`. */
  out: string;
  /** Allow replacing an existing output or manifest file. */
  force?: boolean | undefined;
  /** Also rig the generated mesh and write `<stem>.rigged.glb`. */
  rig?: boolean | undefined;
}

/** The rigging provenance written to the manifest after a successful rig. */
export interface Generate3dRiggingManifest {
  endpoint: string;
  /** Rigging request id; null only when fal returned no envelope id. */
  requestId: string | null;
  /** The exact fal request body sent to the rigging endpoint. */
  input: Record<string, unknown>;
  riggedGlbPath: string;
  riggedGlbUrl: string;
  riggedFbxUrl: string | null;
  /** Basic walking/running variants recorded by URL only; never downloaded. */
  basicAnimationUrls: Record<string, string>;
  costLines: { label: string; usd: number }[];
}

/** Sidecar manifest written next to the generated GLB. */
export interface Generate3dManifest {
  platform: Generate3dPlatform;
  tool: 'chatroom generate-3d';
  sdk: string;
  model: string;
  /** Public model page the licence value was read from. */
  pageUrl: string;
  /** fal catalog licence value, copied verbatim; not a legal interpretation. */
  licenseType: 'commercial';
  /** The exact fal request body that produced the mesh. */
  input: Record<string, unknown>;
  /** Source given by the user and the URL sent to fal; null for text-to-3D. */
  inputImage: { source: string; url: string } | null;
  requestId: string;
  output: {
    path: string;
    sha256: string;
    bytes: number;
    contentType: string;
  };
  /** Separate texture files returned by the model; empty when embedded in the GLB. */
  textureUrls: string[];
  /** Present only when the rigging step succeeded. */
  rigging?: Generate3dRiggingManifest;
  generatedAt: string;
}

export interface Generate3dResult {
  outPath: string;
  manifestPath: string;
  sha256: string;
  /** Cost lines for the CLI to print after the output paths. */
  costLines: string[];
}

/** A validated input image: a public URL or a local file waiting to be uploaded. */
export type Generate3dInputTarget =
  { kind: 'url'; url: string } | { kind: 'file'; path: string; contentType: string };

/** The request the CLI would send, plus the pending upload and cost estimate. */
export interface Generate3dPlan {
  model: Generate3dModelSpec;
  outPath: string;
  manifestPath: string;
  /** Request body; a local input image shows a storage placeholder. */
  input: Record<string, unknown>;
  inputTarget: Generate3dInputTarget | undefined;
  /** What the manifest would record; a local file shows a placeholder URL. */
  inputImage: { source: string; url: string } | null;
  /** Rigged GLB path, or null when `--rig` was not passed. */
  riggedOutPath: string | null;
  /** The rigging call the plan would make; null without `--rig`. */
  riggingRequest: RiggingRequest | null;
  costLines: Generate3dCostLine[];
}

const GLB_CONTENT_TYPE = 'model/gltf-binary';
const GLB_EXTENSION = '.glb';

/**
 * `--dry-run` runs before generation, so the real mesh URL does not exist yet.
 * The plan shows this placeholder in the rigging body.
 */
const PLANNED_MODEL_URL = '<generated mesh GLB URL>';

const RIGGING_HUMANOID_WARNING =
  'Rigging (Meshy) expects a humanoid mesh; non-humanoid meshes fail on fal.';

/** `<out>` without its `.glb` suffix, used for the rigged and clip paths. */
function outputStem(outPath: string): string {
  return outPath.slice(0, -GLB_EXTENSION.length);
}

/** `<stem>.rigged.glb`. */
function riggedOutputPath(outPath: string): string {
  return `${outputStem(outPath)}.rigged${GLB_EXTENSION}`;
}

const HTTP_URL_PATTERN = /^https?:\/\//i;

/**
 * Content types for the input image extensions every allowlisted image-to-3D
 * model accepts. The type is derived from the extension and sent with the
 * upload; bytes are never sniffed. WebP and GIF are intentionally absent:
 * Meshy's image-to-3D endpoint does not accept them.
 */
const INPUT_IMAGE_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

function requireNonEmpty(value: string, message: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Generate3dError(message);
  }
  return trimmed;
}

/** fal has no keyless path: fail before any validation or network call. */
function requireFalKey(deps: Generate3dDeps): void {
  if (!deps.env.FAL_API_KEY) {
    throw new Generate3dError(FAL_API_KEY_MISSING_MESSAGE);
  }
}

/**
 * The command writes a GLB, so a `.glb` path keeps the extension honest. The
 * check runs before any paid call.
 */
function requireGlbExtension(outPath: string): void {
  if (extname(outPath).toLowerCase() !== GLB_EXTENSION) {
    throw new Generate3dError(
      `--out must end with ${GLB_EXTENSION}; generate-3d writes a GLB mesh.`
    );
  }
}

/** Content type for a supported input image extension, or a clear error. */
function inputImageContentType(path: string): string {
  const extension = extname(path).toLowerCase();
  const contentType = INPUT_IMAGE_CONTENT_TYPES[extension];
  if (contentType === undefined) {
    throw new Generate3dError(
      `Unsupported --input-image extension ${extension || '(none)'}. Use one of: ${Object.keys(INPUT_IMAGE_CONTENT_TYPES).join(', ')}.`
    );
  }
  return contentType;
}

function requireModel(modelId: string): Generate3dModelSpec {
  const id = requireNonEmpty(modelId, '--model must not be empty.');
  const model = findGenerate3dModel(id);
  if (model === undefined) {
    throw new Generate3dError(
      `Unknown --model ${id}. Allowed models: ${allowedGenerate3dModelIds().join(', ')}.`
    );
  }
  return model;
}

function requireTextInput(model: Generate3dModelSpec, opts: Generate3dOptions): void {
  if (opts.inputImage !== undefined) {
    throw new Generate3dError(
      `${model.id} is a text-to-3D model; pass --prompt, not --input-image.`
    );
  }
  if ((opts.prompt ?? '').trim().length === 0) {
    throw new Generate3dError(`--prompt is required for ${model.id}.`);
  }
}

function requireImageInput(model: Generate3dModelSpec, opts: Generate3dOptions): void {
  if (opts.prompt !== undefined) {
    throw new Generate3dError(
      `${model.id} is an image-to-3D model; pass --input-image, not --prompt.`
    );
  }
  if ((opts.inputImage ?? '').trim().length === 0) {
    throw new Generate3dError(`--input-image is required for ${model.id}.`);
  }
}

/**
 * Enforce the model's dedicated input flag before any filesystem or network
 * work. Text models take `--prompt`; image models take `--input-image`.
 */
function requireInputKind(model: Generate3dModelSpec, opts: Generate3dOptions): void {
  if (model.inputKind === 'text') {
    requireTextInput(model, opts);
    return;
  }
  requireImageInput(model, opts);
}

/**
 * Validate the input image before the output directory is created. The
 * extension is checked before pathStatus so unsupported formats fail without
 * touching disk; the upload itself happens later, after every other preflight.
 */
async function validateInputImage(
  deps: Generate3dDeps,
  inputImage: string | undefined
): Promise<Generate3dInputTarget | undefined> {
  if (inputImage === undefined) return undefined;
  const value = requireNonEmpty(inputImage, '--input-image must not be empty.');
  if (HTTP_URL_PATTERN.test(value)) return { kind: 'url', url: value };
  const localPath = resolve(value);
  const contentType = inputImageContentType(localPath);
  const status = await deps.pathStatus(localPath);
  if (status !== 'file') {
    throw new Generate3dError(`--input-image is not a file: ${localPath}`);
  }
  return { kind: 'file', path: localPath, contentType };
}

/**
 * Refuse to clobber an existing file or write over a directory unless the user
 * asked with --force. Runs before the paid fal call.
 */
async function requireWritablePath(
  deps: Generate3dDeps,
  path: string,
  label: string,
  force: boolean
): Promise<void> {
  const status = await deps.pathStatus(path);
  if (status === 'directory') {
    throw new Generate3dError(`${label} is a directory: ${path}. Pass a file path.`);
  }
  if (status === 'file' && !force) {
    throw new Generate3dError(`${label} already exists: ${path}. Pass --force to overwrite.`);
  }
}

async function requireWritableOutput(
  deps: Generate3dDeps,
  outPath: string,
  manifestPath: string,
  force: boolean
): Promise<void> {
  await requireWritablePath(deps, outPath, '--out', force);
  await requireWritablePath(deps, manifestPath, 'Manifest', force);
}

/** The value shown for image_url before a local file is uploaded. */
function planInputImageUrl(target: Generate3dInputTarget | undefined): string | undefined {
  if (target === undefined) return undefined;
  return target.kind === 'url' ? target.url : `<fal storage URL for ${target.path}>`;
}

/** What the manifest records for provenance, with a placeholder before upload. */
function planInputImageRecord(
  target: Generate3dInputTarget | undefined
): { source: string; url: string } | null {
  if (target === undefined) return null;
  if (target.kind === 'url') return { source: target.url, url: target.url };
  return { source: target.path, url: `<fal storage URL for ${target.path}>` };
}

/** Upload a validated local file, if any, and return the manifest record. */
async function uploadInputImage(
  deps: Generate3dDeps,
  target: Generate3dInputTarget | undefined
): Promise<{ source: string; url: string } | null> {
  if (target === undefined) return null;
  if (target.kind === 'url') return { source: target.url, url: target.url };
  const url = await deps.uploadFile(target.path, target.contentType);
  return { source: target.path, url };
}

/** Two decimals is enough for whole-cent prices; per-mille prices keep a third. */
function formatUsd(value: number): string {
  return `$${value.toFixed(3).replace(/(\.\d{2})0$/, '$1')}`;
}

function totalUsd(lines: readonly Generate3dCostLine[]): number {
  return lines.reduce((sum, line) => sum + line.usd, 0);
}

/**
 * Render the static list-price estimate. The header states the price date and
 * that the figure is not a bill; fal returns no billed cost.
 */
function formatGenerate3dCost(lines: readonly Generate3dCostLine[]): string[] {
  return [
    `Cost estimate (prices as of ${GENERATE_3D_PRICES_AS_OF}; estimate; fal returns no billed cost):`,
    ...lines.map((line) => `- ${line.label}`),
    `Estimated total: ${formatUsd(totalUsd(lines))}`,
  ];
}

/**
 * The rigging half of a plan. Extracted so the plan reads as one path when
 * `--rig` is absent and one when it is present.
 */
function buildRiggingPlan(
  outPath: string,
  rig: boolean
): {
  riggedOutPath: string | null;
  riggingRequest: RiggingRequest | null;
  extraCostLines: Generate3dCostLine[];
} {
  if (!rig) {
    return { riggedOutPath: null, riggingRequest: null, extraCostLines: [] };
  }
  return {
    riggedOutPath: riggedOutputPath(outPath),
    riggingRequest: buildRiggingRequest({ modelGlbUrl: PLANNED_MODEL_URL }),
    extraCostLines: riggingCostLines(),
  };
}

/**
 * Run every preflight check and build the request without a paid call or an
 * upload. The static cost table needs no network, so `--dry-run` works offline
 * and without `FAL_API_KEY`.
 */
export async function planGenerate3d(
  opts: Generate3dOptions,
  deps: Generate3dDeps
): Promise<Generate3dPlan> {
  const model = requireModel(opts.model);
  const outPath = resolve(requireNonEmpty(opts.out, '--out must not be empty.'));
  requireGlbExtension(outPath);
  requireInputKind(model, opts);

  const rigging = buildRiggingPlan(outPath, opts.rig === true);
  const manifestPath = `${outPath}.json`;
  const inputTarget = await validateInputImage(deps, opts.inputImage);
  await requireWritableOutput(deps, outPath, manifestPath, opts.force === true);
  if (rigging.riggedOutPath !== null) {
    await requireWritablePath(deps, rigging.riggedOutPath, 'Rigged GLB', opts.force === true);
  }

  const input = model.buildInput({
    prompt: opts.prompt,
    imageUrl: planInputImageUrl(inputTarget),
  });
  return {
    model,
    outPath,
    manifestPath,
    input,
    inputTarget,
    inputImage: planInputImageRecord(inputTarget),
    riggedOutPath: rigging.riggedOutPath,
    riggingRequest: rigging.riggingRequest,
    costLines: [...model.cost().lines, ...rigging.extraCostLines],
  };
}

function formatInputImageLine(target: Generate3dInputTarget | undefined): string | undefined {
  if (target === undefined) return undefined;
  return target.kind === 'url'
    ? `Input image ${target.url} (passed through)`
    : `Input image ${target.path} (would be uploaded to fal storage, 1-day lifetime)`;
}

/** The rigging half of a `--dry-run` plan: endpoint, body, paths, warning. */
function formatRiggingPlan(plan: Generate3dPlan): string[] {
  if (plan.riggingRequest === null || plan.riggedOutPath === null) return [];
  return [
    `Rigging request (${plan.riggingRequest.endpoint}):`,
    JSON.stringify(plan.riggingRequest.input, null, 2),
    `Rigged GLB ${plan.riggedOutPath}`,
    RIGGING_HUMANOID_WARNING,
  ];
}

/** Render a plan for `--dry-run`: paths, model, request, and cost estimate. */
export function formatGenerate3dPlan(plan: Generate3dPlan): string {
  const lines = [
    `Would generate ${plan.outPath}`,
    `Manifest ${plan.manifestPath}`,
    `Model ${plan.model.id} (${plan.model.inputKind}-to-3D, licence: ${plan.model.licenseType})`,
  ];
  const inputLine = formatInputImageLine(plan.inputTarget);
  if (inputLine !== undefined) lines.push(inputLine);
  lines.push(
    'Request:',
    JSON.stringify(plan.input, null, 2),
    ...formatRiggingPlan(plan),
    ...formatGenerate3dCost(plan.costLines),
    'No upload or fal generation call was made.'
  );
  return lines.join('\n');
}

/**
 * Failures after a successful (paid) generation still name the request id and
 * GLB URL so the result can be recovered manually.
 */
async function withRecovery<T>(
  action: string,
  context: { requestId: string; url: string },
  run: () => Promise<T>
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Generate3dError(
      `Failed to ${action} generated GLB for request ${context.requestId} (${context.url}): ${detail}. The generated mesh can still be recovered from that URL.`
    );
  }
}

function buildManifest(args: {
  model: Generate3dModelSpec;
  input: Record<string, unknown>;
  inputImage: { source: string; url: string } | null;
  requestId: string;
  outPath: string;
  sha256: string;
  byteLength: number;
  textureUrls: string[];
  generatedAt: string;
  sdkVersion: string;
}): Generate3dManifest {
  return {
    platform: 'fal',
    tool: 'chatroom generate-3d',
    sdk: `@fal-ai/client@${args.sdkVersion}`,
    model: args.model.id,
    pageUrl: args.model.pageUrl,
    licenseType: args.model.licenseType,
    input: args.input,
    inputImage: args.inputImage,
    requestId: args.requestId,
    output: {
      path: args.outPath,
      sha256: args.sha256,
      bytes: args.byteLength,
      contentType: GLB_CONTENT_TYPE,
    },
    textureUrls: args.textureUrls,
    generatedAt: args.generatedAt,
  };
}

/** Adapt the model-specific result; a paid request's id stays in the error. */
function readModelOutput(
  model: Generate3dModelSpec,
  data: unknown,
  requestId: string
): { glbUrl: string; textureUrls: string[] } {
  try {
    return model.readOutput(data);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Generate3dError(`${detail} [requestId: ${requestId}]`);
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * A rig failure keeps the already-written mesh and generation manifest: the
 * paid generation is never discarded. The rig request id is included whenever
 * fal returned one so the rig can be investigated separately.
 */
function riggingFailure(args: {
  endpoint: string;
  requestId: string | null;
  detail: string;
  meshPath: string;
}): Generate3dError {
  const request = args.requestId === null ? '' : ` for request ${args.requestId}`;
  return new Generate3dError(
    `Rigging failed${request} (${args.endpoint}): ${args.detail}. The generated mesh and manifest are kept: ${args.meshPath}.`
  );
}

/** Download one rigged or clip GLB and save it; failures name the file. */
async function downloadAndSaveGlb(args: {
  deps: Generate3dDeps;
  url: string;
  path: string;
  label: string;
  fail: (detail: string) => Generate3dError;
}): Promise<void> {
  let bytes: Uint8Array;
  try {
    bytes = await args.deps.fetchGlb(args.url);
  } catch (err) {
    throw args.fail(`Failed to download ${args.label} (${args.url}): ${describeError(err)}`);
  }
  try {
    await args.deps.writeFile(args.path, bytes);
  } catch (err) {
    throw args.fail(`Failed to save ${args.label} ${args.path}: ${describeError(err)}`);
  }
}

/**
 * Run the rigging step after the mesh is on disk: one fal call, then one
 * download per returned GLB. Only GLBs are downloaded; the FBX and basic
 * walking/running variants stay as manifest URLs.
 */
async function runRigging(
  plan: Generate3dPlan,
  deps: Generate3dDeps,
  modelGlbUrl: string
): Promise<Generate3dRiggingManifest> {
  if (plan.riggedOutPath === null) {
    throw new Generate3dError('Rigging was planned without a rigged output path.');
  }
  const riggedGlbPath = plan.riggedOutPath;
  const request = buildRiggingRequest({ modelGlbUrl });

  let result: Awaited<ReturnType<Generate3dDeps['falSubscribe']>>;
  try {
    result = await deps.falSubscribe(request.endpoint, request.input);
  } catch (err) {
    throw riggingFailure({
      endpoint: request.endpoint,
      requestId: null,
      detail: describeError(err),
      meshPath: plan.outPath,
    });
  }

  const requestId = result.requestId;
  const fail = (detail: string): Generate3dError =>
    riggingFailure({ endpoint: request.endpoint, requestId, detail, meshPath: plan.outPath });

  let output: RiggingOutput;
  try {
    output = readRiggingOutput(result.data);
  } catch (err) {
    throw fail(describeError(err));
  }

  await downloadAndSaveGlb({
    deps,
    url: output.riggedGlbUrl,
    path: riggedGlbPath,
    label: 'rigged GLB',
    fail,
  });

  return {
    endpoint: request.endpoint,
    requestId,
    input: request.input,
    riggedGlbPath,
    riggedGlbUrl: output.riggedGlbUrl,
    riggedFbxUrl: output.riggedFbxUrl,
    basicAnimationUrls: output.basicAnimationUrls,
    costLines: riggingCostLines(),
  };
}

/**
 * Generate one mesh: upload a local input image if needed, call fal once,
 * download the GLB, and write the output plus its manifest. With `--rig`, run
 * the rigging step and rewrite the manifest with the rigging section.
 */
export async function generate3d(
  opts: Generate3dOptions,
  deps: Generate3dDeps
): Promise<Generate3dResult> {
  requireFalKey(deps);
  const plan = await planGenerate3d(opts, deps);

  // Preflight before the paid call: create the parent directory so a
  // successful generation cannot fail on a missing dir.
  await deps.ensureParentDir(plan.outPath);
  const inputImage = await uploadInputImage(deps, plan.inputTarget);
  const input = plan.model.buildInput({
    prompt: opts.prompt,
    imageUrl: inputImage?.url,
  });

  const result = await deps.falSubscribe(plan.model.id, input);
  const output = readModelOutput(plan.model, result.data, result.requestId);
  const recovery = { requestId: result.requestId, url: output.glbUrl };
  const bytes = await withRecovery('download', recovery, () => deps.fetchGlb(output.glbUrl));
  await withRecovery('save', recovery, () => deps.writeFile(plan.outPath, bytes));

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const manifest = buildManifest({
    model: plan.model,
    input,
    inputImage,
    requestId: result.requestId,
    outPath: plan.outPath,
    sha256,
    byteLength: bytes.byteLength,
    textureUrls: output.textureUrls,
    generatedAt: deps.now().toISOString(),
    sdkVersion: deps.sdkVersion,
  });
  // Write the generation manifest first so a failed rig still leaves both the
  // mesh and its provenance on disk.
  await deps.writeJson(plan.manifestPath, manifest);

  if (plan.riggingRequest !== null) {
    const rigging = await runRigging(plan, deps, output.glbUrl);
    await deps.writeJson(plan.manifestPath, { ...manifest, rigging });
  }

  return {
    outPath: plan.outPath,
    manifestPath: plan.manifestPath,
    sha256,
    costLines: formatGenerate3dCost(plan.costLines),
  };
}
