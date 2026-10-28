/**
 * Generate 3D — pure logic for `chatroom generate-3d`.
 *
 * Generates one GLB mesh through an injected fal subscriber, writes the bytes
 * to `out`, and writes a JSON sidecar manifest to `<out>.json`. It then packages
 * the run — a web variant of the master, a package manifest, the zip, and the
 * preview — and only afterwards, with `--rig`, calls Meshy's rigging endpoint to
 * write `<stem>.rigged.glb` and one `<stem>.anim-<id>.glb` per requested preset
 * clip. The sidecar is rewritten after packaging and again after rigging.
 *
 * Packaging runs before rigging because the package is a pure function of the
 * master: a rig failure must not cost the user the packaged asset. The master
 * and sidecar are written before either step, so no packaging or rigging failure
 * discards a paid generation. No SDK, network, clock, or
 * filesystem access is imported here; all of it arrives through
 * `Generate3dDeps`, so the unit tests run fully offline.
 */

import { createHash } from 'node:crypto';
import { basename, dirname, extname, join, resolve } from 'node:path';

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
  DEFAULT_NAME_TEMPLATE,
  formatTimestamp,
  renderPackageName,
  templateNeedsRequestId,
} from './package-name.js';
import { renderPreviewHtml } from './preview-html.js';
import {
  buildRiggingRequest,
  parseAnimationActionIds,
  readRiggingOutput,
  riggingCostLines,
  type RiggingOutput,
  type RiggingRequest,
} from './rigging.js';
import type { GlbStats, WebVariant } from './web-variant.js';
import type { ZipEntry } from './zip-package.js';
import { FAL_API_KEY_MISSING_MESSAGE } from '../generate-image/image.js';

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
  /**
   * Raw `--animation-action-id` values in the order given. Validated by the
   * plan so an invalid id fails before any paid call. Requires `rig`.
   */
  animationActionIds?: readonly string[] | undefined;
  /**
   * Template for the package base name. Defaults to
   * {@link DEFAULT_NAME_TEMPLATE}; validated by the plan before the paid call.
   */
  name?: string | undefined;
  /** Directory for the package zip; defaults to the directory of `out`. */
  packageDir?: string | undefined;
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
  animations: { actionId: number; path: string; glbUrl: string }[];
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
  /**
   * Package files written beside the sidecar. Present once packaging ran; the
   * names are base-name siblings of the zip and the preview.
   */
  package?: { zip: string; html: string };
  /** Present only when the rigging step succeeded. */
  rigging?: Generate3dRiggingManifest;
  generatedAt: string;
}

export interface Generate3dResult {
  outPath: string;
  manifestPath: string;
  /** The zip package holding the master, the web variant, and the manifest. */
  zipPath: string;
  /** The standalone preview of the web variant, beside the zip. */
  htmlPath: string;
  sha256: string;
  /** Cost lines for the CLI to print after the output paths. */
  costLines: string[];
}

/** One variant entry in the package manifest. */
interface Generate3dPackageVariant {
  name: 'master' | 'web';
  file: string;
  bytes: number;
  sha256: string;
  triangles: number;
  textures: { width: number; height: number; mimeType: string }[];
  extensionsUsed: string[];
  /** Present on the web variant only; the master is whatever fal returned. */
  settings?: {
    maxTexturePx: number;
    textureFormat: 'jpeg';
    quality: number;
    triangleTarget: number;
    simplified: boolean;
  };
}

/** `manifest.json` written inside the package zip. */
interface Generate3dPackageManifest {
  schemaVersion: 1;
  package: { name: string; zip: string; createdAt: string };
  generator: {
    tool: 'chatroom generate-3d';
    model: string;
    requestId: string;
    prompt: string | null;
    inputImage: string | null;
  };
  variants: Generate3dPackageVariant[];
  licence: Generate3dModelSpec['licenseType'];
  pricing: { estimatedTotalUsd: number; note: string };
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
  /** Validated clip ids in the order given; empty without `--rig`. */
  animationActionIds: number[];
  /** Rigged GLB path, or null when `--rig` was not passed. */
  riggedOutPath: string | null;
  /** One output path per requested clip; empty without `--rig`. */
  animationOutPaths: { actionId: number; path: string }[];
  /** The rigging call the plan would make; null without `--rig`. */
  riggingRequest: RiggingRequest | null;
  costLines: Generate3dCostLine[];
  /** Master file name without its `.glb` suffix; used for the zip entries. */
  stem: string;
  /** The `--name` template, already validated. */
  nameTemplate: string;
  /** UTC `YYYYMMDD-HHmmss`, taken once when the plan is built. */
  timestamp: string;
  /** Directory the package zip is written to. */
  packageDir: string;
  /**
   * Rendered package base name, or null when the template needs the fal request
   * id and the name can only be rendered after the call.
   */
  packageName: string | null;
  /** `<packageDir>/<packageName>.zip`, or null when the name is deferred. */
  zipPath: string | null;
  /** `<packageDir>/<packageName>.html`, or null when the name is deferred. */
  htmlPath: string | null;
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

/** Web-variant settings, recorded in the package manifest so they are reproducible. */
const WEB_VARIANT_TRIANGLE_TARGET = 30_000;
const WEB_VARIANT_MAX_TEXTURE_PX = 1024;
const WEB_VARIANT_TEXTURE_QUALITY = 80;

/** File name of the package manifest inside the zip. */
const PACKAGE_MANIFEST_NAME = 'manifest.json';

/** The package manifest repeats the CLI's caveat about prices. */
const PACKAGE_PRICING_NOTE = 'list-price estimate, not a billed amount';

/** `<out>` without its `.glb` suffix, used for the rigged and clip paths. */
function outputStem(outPath: string): string {
  return outPath.slice(0, -GLB_EXTENSION.length);
}

/**
 * `<out>`'s file name without its `.glb` suffix. Package entries are named from
 * this, so a master in a deep directory still lands at `chest.glb` in the zip.
 */
function packageStem(outPath: string): string {
  return basename(outPath).slice(0, -GLB_EXTENSION.length);
}

/** `<stem>.rigged.glb`. */
function riggedOutputPath(outPath: string): string {
  return `${outputStem(outPath)}.rigged${GLB_EXTENSION}`;
}

/** `<stem>.anim-<actionId>.glb`. */
function animationOutputPath(outPath: string, actionId: number): string {
  return `${outputStem(outPath)}.anim-${actionId}${GLB_EXTENSION}`;
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

/** The rigging half of a plan; empty when `--rig` is absent. */
interface PlannedRigging {
  riggedOutPath: string | null;
  animationOutPaths: { actionId: number; path: string }[];
  riggingRequest: RiggingRequest | null;
  extraCostLines: Generate3dCostLine[];
}

function buildRiggingPlan(
  outPath: string,
  rig: boolean,
  animationActionIds: readonly number[]
): PlannedRigging {
  if (!rig) {
    return {
      riggedOutPath: null,
      animationOutPaths: [],
      riggingRequest: null,
      extraCostLines: [],
    };
  }
  return {
    riggedOutPath: riggedOutputPath(outPath),
    animationOutPaths: animationActionIds.map((actionId) => ({
      actionId,
      path: animationOutputPath(outPath, actionId),
    })),
    riggingRequest: buildRiggingRequest({ modelGlbUrl: PLANNED_MODEL_URL, animationActionIds }),
    extraCostLines: riggingCostLines(animationActionIds.length),
  };
}

/** Refuse to clobber any planned rig output unless `--force` was passed. */
async function requireWritableRiggingPaths(
  deps: Generate3dDeps,
  rigging: PlannedRigging,
  force: boolean
): Promise<void> {
  if (rigging.riggedOutPath === null) return;
  await requireWritablePath(deps, rigging.riggedOutPath, 'Rigged GLB', force);
  for (const animation of rigging.animationOutPaths) {
    await requireWritablePath(
      deps,
      animation.path,
      `Animation clip ${animation.actionId} GLB`,
      force
    );
  }
}

/** Package naming decided before the fal call. */
interface ResolvedPackageNaming {
  stem: string;
  nameTemplate: string;
  timestamp: string;
  packageDir: string;
  /** Rendered base name, or null when it needs the fal request id. */
  packageName: string | null;
  /** `<packageDir>/<base>.zip`, or null when the name is deferred. */
  zipPath: string | null;
  /** `<packageDir>/<base>.html`, or null when the name is deferred. */
  htmlPath: string | null;
}

/**
 * The two package files. They share the base name, so they sort together in a
 * directory listing and a reader can pair them by sight.
 */
function packageFilePaths(packageDir: string, base: string): { zipPath: string; htmlPath: string } {
  return { zipPath: join(packageDir, `${base}.zip`), htmlPath: join(packageDir, `${base}.html`) };
}

/** `--package-dir`, or the master's directory when the flag is absent or blank. */
function resolvePackageDir(outPath: string, packageDir: string | undefined): string {
  if (packageDir === undefined || packageDir.trim().length === 0) return dirname(outPath);
  return resolve(packageDir);
}

/**
 * Resolve and validate the package name.
 *
 * A template without `{requestId8}` renders here, so its collision check runs
 * before the paid call. A template with it cannot render yet: the shape is
 * validated with a stand-in id, and the real name is rendered after the call.
 */
function resolvePackageNaming(
  opts: Generate3dOptions,
  model: Generate3dModelSpec,
  outPath: string,
  now: Date
): ResolvedPackageNaming {
  const nameTemplate = opts.name ?? DEFAULT_NAME_TEMPLATE;
  const stem = packageStem(outPath);
  const timestamp = formatTimestamp(now);
  const packageDir = resolvePackageDir(outPath, opts.packageDir);
  const vars = { stem, model: model.id, timestamp };

  if (templateNeedsRequestId(nameTemplate)) {
    // Validate the template now; the id itself only exists after the call.
    renderPackageName(nameTemplate, { ...vars, requestId8: '00000000' });
    return {
      stem,
      nameTemplate,
      timestamp,
      packageDir,
      packageName: null,
      zipPath: null,
      htmlPath: null,
    };
  }

  const packageName = renderPackageName(nameTemplate, vars);
  return {
    stem,
    nameTemplate,
    timestamp,
    packageDir,
    packageName,
    ...packageFilePaths(packageDir, packageName),
  };
}

/** Clips are a rigging feature, so the flag pairing is checked with the args. */
function requireRigForClips(rig: boolean, animationActionIds: readonly number[]): void {
  if (animationActionIds.length > 0 && !rig) {
    throw new Generate3dError('--animation-action-id requires --rig.');
  }
}

/** Refuse to clobber the master, its sidecar, any rig output, or the package. */
async function requireWritablePlanPaths(args: {
  deps: Generate3dDeps;
  force: boolean;
  outPath: string;
  manifestPath: string;
  rigging: PlannedRigging;
  naming: ResolvedPackageNaming;
}): Promise<void> {
  await requireWritableOutput(args.deps, args.outPath, args.manifestPath, args.force);
  await requireWritableRiggingPaths(args.deps, args.rigging, args.force);
  await requireWritablePackage(args.deps, args.naming, args.force);
}

/** Refuse to clobber the package zip or its preview when their names are known. */
async function requireWritablePackage(
  deps: Generate3dDeps,
  paths: { zipPath: string | null; htmlPath: string | null },
  force: boolean
): Promise<void> {
  if (paths.zipPath !== null) await requireWritablePath(deps, paths.zipPath, 'Package', force);
  if (paths.htmlPath !== null) await requireWritablePath(deps, paths.htmlPath, 'Preview', force);
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

  const rig = opts.rig === true;
  const animationActionIds = parseAnimationActionIds(opts.animationActionIds ?? []);
  requireRigForClips(rig, animationActionIds);
  const rigging = buildRiggingPlan(outPath, rig, animationActionIds);

  const manifestPath = `${outPath}.json`;
  const inputTarget = await validateInputImage(deps, opts.inputImage);
  const naming = resolvePackageNaming(opts, model, outPath, deps.now());
  await requireWritablePlanPaths({
    deps,
    force: opts.force === true,
    outPath,
    manifestPath,
    rigging,
    naming,
  });

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
    animationActionIds,
    riggedOutPath: rigging.riggedOutPath,
    animationOutPaths: rigging.animationOutPaths,
    riggingRequest: rigging.riggingRequest,
    costLines: [...model.cost().lines, ...rigging.extraCostLines],
    ...naming,
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
    ...plan.animationOutPaths.map(
      (animation) => `Animation clip ${animation.actionId} ${animation.path}`
    ),
    RIGGING_HUMANOID_WARNING,
  ];
}

/** Render a plan for `--dry-run`: paths, model, request, and cost estimate. */
export function formatGenerate3dPlan(plan: Generate3dPlan): string {
  const lines = [
    `Would generate ${plan.outPath}`,
    `Manifest ${plan.manifestPath}`,
    `Package ${plan.zipPath ?? `${plan.packageDir} (name depends on {requestId8})`}`,
    `Preview ${plan.htmlPath ?? `${plan.packageDir} (name depends on {requestId8})`}`,
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

/** Download and save each returned clip, in the requested order. */
async function downloadAnimations(
  plan: Generate3dPlan,
  deps: Generate3dDeps,
  output: RiggingOutput,
  fail: (detail: string) => Generate3dError
): Promise<Generate3dRiggingManifest['animations']> {
  const animations: Generate3dRiggingManifest['animations'] = [];
  for (const [index, animation] of output.animations.entries()) {
    const planned = plan.animationOutPaths[index];
    if (planned === undefined || planned.actionId !== animation.actionId) {
      throw fail(`No planned output path for animation clip ${animation.actionId}.`);
    }
    await downloadAndSaveGlb({
      deps,
      url: animation.glbUrl,
      path: planned.path,
      label: `animation clip ${animation.actionId}`,
      fail,
    });
    animations.push({
      actionId: animation.actionId,
      path: planned.path,
      glbUrl: animation.glbUrl,
    });
  }
  return animations;
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
  const request = buildRiggingRequest({
    modelGlbUrl,
    animationActionIds: plan.animationActionIds,
  });

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
    output = readRiggingOutput(result.data, { animationActionIds: plan.animationActionIds });
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
  const animations = await downloadAnimations(plan, deps, output, fail);

  return {
    endpoint: request.endpoint,
    requestId,
    input: request.input,
    riggedGlbPath,
    riggedGlbUrl: output.riggedGlbUrl,
    riggedFbxUrl: output.riggedFbxUrl,
    basicAnimationUrls: output.basicAnimationUrls,
    animations,
    costLines: riggingCostLines(plan.animationActionIds.length),
  };
}

/** The master variant entry: what fal returned, unchanged. */
function buildMasterVariant(args: {
  stem: string;
  masterBytes: Uint8Array;
  masterSha256: string;
  source: GlbStats;
}): Generate3dPackageVariant {
  return {
    name: 'master',
    file: `${args.stem}.glb`,
    bytes: args.masterBytes.byteLength,
    sha256: args.masterSha256,
    triangles: args.source.triangles,
    textures: args.source.textures,
    extensionsUsed: args.source.extensionsUsed,
  };
}

/** The web variant entry, with the settings that produced it. */
function buildWebVariantEntry(
  stem: string,
  web: WebVariant,
  webSha256: string
): Generate3dPackageVariant {
  return {
    name: 'web',
    file: `web/${stem}.web.glb`,
    bytes: web.bytes.byteLength,
    sha256: webSha256,
    triangles: web.triangles,
    textures: web.textures,
    extensionsUsed: web.extensionsUsed,
    settings: {
      maxTexturePx: WEB_VARIANT_MAX_TEXTURE_PX,
      textureFormat: 'jpeg',
      quality: WEB_VARIANT_TEXTURE_QUALITY,
      triangleTarget: WEB_VARIANT_TRIANGLE_TARGET,
      simplified: web.simplified,
    },
  };
}

/**
 * Build `manifest.json` for the package: what the zip holds, how each variant
 * was made, and the provenance a consumer needs without the sidecar.
 */
function buildPackageManifest(args: {
  packageName: string;
  createdAt: string;
  model: Generate3dModelSpec;
  requestId: string;
  prompt: string | undefined;
  inputImage: { source: string; url: string } | null;
  masterBytes: Uint8Array;
  masterSha256: string;
  web: WebVariant;
  /** SHA-256 of the web variant bytes; also shown by the preview. */
  webSha256: string;
  stem: string;
  totalUsd: number;
}): Generate3dPackageManifest {
  return {
    schemaVersion: 1,
    package: {
      name: args.packageName,
      zip: `${args.packageName}.zip`,
      createdAt: args.createdAt,
    },
    generator: {
      tool: 'chatroom generate-3d',
      model: args.model.id,
      requestId: args.requestId,
      prompt: args.prompt?.trim() ?? null,
      // The path or URL the user gave, not the temporary fal storage URL.
      inputImage: args.inputImage?.source ?? null,
    },
    variants: [
      buildMasterVariant({
        stem: args.stem,
        masterBytes: args.masterBytes,
        masterSha256: args.masterSha256,
        source: args.web.source,
      }),
      buildWebVariantEntry(args.stem, args.web, args.webSha256),
    ],
    licence: args.model.licenseType,
    pricing: {
      // Three decimals keeps a per-mille price such as $0.225 exact while
      // dropping binary-float noise from the sum.
      estimatedTotalUsd: Math.round(args.totalUsd * 1000) / 1000,
      note: PACKAGE_PRICING_NOTE,
    },
  };
}

/** The three zip entries; `zipPackage` sorts them. */
function buildPackageEntries(args: {
  stem: string;
  masterBytes: Uint8Array;
  webBytes: Uint8Array;
  manifestJson: string;
}): ZipEntry[] {
  return [
    { path: `${args.stem}.glb`, bytes: args.masterBytes },
    { path: `web/${args.stem}.web.glb`, bytes: args.webBytes },
    { path: PACKAGE_MANIFEST_NAME, bytes: new TextEncoder().encode(args.manifestJson) },
  ];
}

/** The package paths, resolved after the call when `{requestId8}` deferred them. */
function resolvePackagePaths(
  plan: Generate3dPlan,
  requestId: string
): { packageName: string; zipPath: string; htmlPath: string } {
  const packageName =
    plan.packageName ??
    renderPackageName(plan.nameTemplate, {
      stem: plan.stem,
      model: plan.model.id,
      timestamp: plan.timestamp,
      requestId8: requestId.slice(0, 8),
    });
  return { packageName, ...packageFilePaths(plan.packageDir, packageName) };
}

/** Wrap one packaging step so a failure names what was kept. */
function packageFailure(plan: Generate3dPlan, step: string, err: unknown): Generate3dError {
  return new Generate3dError(
    `Failed to ${step}: ${describeError(err)}. The master mesh and manifest are kept: ${plan.outPath}.`
  );
}

/**
 * A packaging failure after the paid call. It names the request id and the GLB
 * URL like `withRecovery` does, so the mesh can be recovered without paying again.
 */
function packageFailureForRequest(args: {
  plan: Generate3dPlan;
  master: MasterOutput;
  step: string;
  err: unknown;
}): Generate3dError {
  return packageFailure(
    args.plan,
    `${args.step} for request ${args.master.requestId} (${args.master.glbUrl})`,
    args.err
  );
}

/** Build the web variant, reporting a failure without discarding the master. */
async function buildWebVariant(
  plan: Generate3dPlan,
  deps: Generate3dDeps,
  masterBytes: Uint8Array
): Promise<WebVariant> {
  try {
    return await deps.createWebVariant(masterBytes, {
      triangleTarget: WEB_VARIANT_TRIANGLE_TARGET,
      maxTexturePx: WEB_VARIANT_MAX_TEXTURE_PX,
      quality: WEB_VARIANT_TEXTURE_QUALITY,
    });
  } catch (err) {
    throw packageFailure(plan, 'build the web variant', err);
  }
}

/** Build the zip bytes in memory, before anything is written. */
function buildZip(
  plan: Generate3dPlan,
  deps: Generate3dDeps,
  args: {
    packageManifest: Generate3dPackageManifest;
    masterBytes: Uint8Array;
    webBytes: Uint8Array;
  }
): Uint8Array {
  try {
    return deps.zipPackage(
      buildPackageEntries({
        stem: plan.stem,
        masterBytes: args.masterBytes,
        webBytes: args.webBytes,
        manifestJson: JSON.stringify(args.packageManifest, null, 2),
      })
    );
  } catch (err) {
    throw packageFailure(plan, 'build the package zip', err);
  }
}

/** Remove a file, reporting (not raising) a cleanup failure. */
async function removeQuietly(deps: Generate3dDeps, path: string): Promise<string> {
  try {
    await deps.removeFile(path);
    return '';
  } catch {
    return ` (${path} could not be removed)`;
  }
}

/**
 * Write the zip, then the preview beside it.
 *
 * The two files are a pair, so a preview that cannot be written rolls the zip
 * back rather than leaving a package without its preview.
 */
async function writeZipAndPreview(
  plan: Generate3dPlan,
  deps: Generate3dDeps,
  files: {
    zipPath: string;
    zipBytes: Uint8Array;
    htmlPath: string;
    html: string;
    force: boolean;
  }
): Promise<void> {
  // With --force and a fixed --name, the previous pair would otherwise stay
  // beside the new master. Both are removed first, then written fresh.
  if (files.force) {
    await removeQuietly(deps, files.zipPath);
    await removeQuietly(deps, files.htmlPath);
  }

  try {
    await deps.writeFile(files.zipPath, files.zipBytes);
  } catch (err) {
    // A failed write can leave a truncated zip; do not keep it.
    const cleanup = await removeQuietly(deps, files.zipPath);
    throw packageFailure(plan, `save the package ${files.zipPath}${cleanup}`, err);
  }

  try {
    await deps.writeFile(files.htmlPath, new TextEncoder().encode(files.html));
  } catch (err) {
    const cleanup = await removeQuietly(deps, files.zipPath);
    throw packageFailure(plan, `save the preview ${files.htmlPath}${cleanup}`, err);
  }
}

/** The zip's file name, and the preview's, from one base name. */
interface PackageOutput {
  zipPath: string;
  htmlPath: string;
}

/**
 * Build and write the package files.
 *
 * The master is already on disk, so every failure here is reported without
 * discarding it: the web variant, the package manifest, the zip, and the preview
 * are built in memory first, then written in that order.
 */
/** A package failure that names the paid request and the URL it can be recovered from. */
async function requirePackagePaths(args: {
  plan: Generate3dPlan;
  deps: Generate3dDeps;
  master: MasterOutput;
  paths: PackageOutput;
  force: boolean;
}): Promise<void> {
  try {
    await requireWritablePackage(args.deps, args.paths, args.force);
  } catch (err) {
    throw packageFailureForRequest({
      plan: args.plan,
      master: args.master,
      step: 'write the package',
      err,
    });
  }
}

async function writePackage(args: {
  plan: Generate3dPlan;
  deps: Generate3dDeps;
  master: MasterOutput;
  packageName: string;
  paths: PackageOutput;
  prompt: string | undefined;
  force: boolean;
}): Promise<PackageOutput> {
  const { plan, deps, master, paths } = args;
  // The pre-call plan checks a name it can render; a `{requestId8}` name only
  // exists now, so its collision is checked here, after the master and sidecar
  // are already safe on disk.
  await requirePackagePaths({ plan, deps, master, paths, force: args.force });

  const web = await buildWebVariant(plan, deps, master.bytes);
  const webSha256 = createHash('sha256').update(web.bytes).digest('hex');
  const packageManifest = buildPackageManifest({
    packageName: args.packageName,
    createdAt: deps.now().toISOString(),
    model: plan.model,
    requestId: master.requestId,
    prompt: args.prompt,
    inputImage: master.inputImage,
    masterBytes: master.bytes,
    masterSha256: master.sha256,
    web,
    webSha256,
    stem: plan.stem,
    totalUsd: totalUsd(plan.costLines),
  });
  const zipBytes = buildZip(plan, deps, {
    packageManifest,
    masterBytes: master.bytes,
    webBytes: web.bytes,
  });
  const html = renderPreviewHtml({
    title: args.packageName,
    modelId: plan.model.id,
    prompt: args.prompt?.trim() ?? null,
    requestId: master.requestId,
    webGlb: web.bytes,
    webSha256,
    webTriangles: web.triangles,
    masterTriangles: web.source.triangles,
    masterBytes: master.bytes.byteLength,
    webBytes: web.bytes.byteLength,
    masterZipEntry: `${plan.stem}.glb`,
    zipName: `${args.packageName}.zip`,
  });

  await writeZipAndPreview(plan, deps, { ...paths, zipBytes, html, force: args.force });
  return paths;
}

/** What one paid generation produced, before rigging and packaging. */
interface MasterOutput {
  bytes: Uint8Array;
  sha256: string;
  requestId: string;
  inputImage: { source: string; url: string } | null;
  /** The fal GLB URL, needed by the rigging step. */
  glbUrl: string;
  /** The sidecar manifest as first written, before any rigging section. */
  manifest: Generate3dManifest;
}

/**
 * Run the paid half: upload the input image if any, call fal once, download the
 * GLB, and write both the master and its sidecar manifest.
 *
 * Nothing about the package is checked or written here: the master and its
 * provenance have to survive a package-name collision, so the package is planned
 * from the finished master in {@link writePackage}.
 */
async function generateMaster(
  plan: Generate3dPlan,
  deps: Generate3dDeps,
  opts: Generate3dOptions
): Promise<MasterOutput> {
  // Preflight before the paid call: create the directories so a successful
  // generation cannot fail on a missing one. Only the directory matters for the
  // package, so a deferred name still gets a writable destination.
  await deps.ensureParentDir(plan.outPath);
  await deps.ensureParentDir(packageFilePaths(plan.packageDir, plan.stem).zipPath);

  const inputImage = await uploadInputImage(deps, plan.inputTarget);
  const input = plan.model.buildInput({ prompt: opts.prompt, imageUrl: inputImage?.url });
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
  // Write the generation manifest first so a failed rig or package still leaves
  // both the mesh and its provenance on disk.
  await deps.writeJson(plan.manifestPath, manifest);

  return {
    bytes,
    sha256,
    requestId: result.requestId,
    inputImage,
    glbUrl: output.glbUrl,
    manifest,
  };
}

/**
 * Generate one mesh: run the paid generation, optionally rig it, then package the
 * master with a web variant and a package manifest.
 */
export async function generate3d(
  opts: Generate3dOptions,
  deps: Generate3dDeps
): Promise<Generate3dResult> {
  requireFalKey(deps);
  const plan = await planGenerate3d(opts, deps);
  const master = await generateMaster(plan, deps, opts);
  const { packageName, zipPath, htmlPath } = resolvePackagePaths(plan, master.requestId);

  // Package before rigging: the package is a pure function of the master, so a
  // rig failure cannot cost the user the packaged asset.
  await writePackage({
    plan,
    deps,
    master,
    packageName,
    paths: { zipPath, htmlPath },
    prompt: opts.prompt,
    force: opts.force === true,
  });

  // Link the package files in the sidecar now that their names are resolved.
  const manifest: Generate3dManifest = {
    ...master.manifest,
    package: { zip: basename(zipPath), html: basename(htmlPath) },
  };
  await deps.writeJson(plan.manifestPath, manifest);

  if (plan.riggingRequest !== null) {
    const rigging = await runRigging(plan, deps, master.glbUrl);
    await deps.writeJson(plan.manifestPath, { ...manifest, rigging });
  }

  return {
    outPath: plan.outPath,
    manifestPath: plan.manifestPath,
    zipPath,
    htmlPath,
    sha256: master.sha256,
    costLines: formatGenerate3dCost(plan.costLines),
  };
}
