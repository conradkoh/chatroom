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

import {
  buildReferenceImageRequest,
  type Generate3dDeps,
  type GenerateReferenceImageRequest,
} from './deps.js';
import {
  DEFAULT_GENERATE_3D_MODEL_ID,
  Generate3dError,
  GENERATE_3D_MODELS,
  GENERATE_3D_PRICES_AS_OF,
  needsReferenceImage,
  REFERENCE_IMAGE_COST_LABEL,
  REFERENCE_IMAGE_COST_USD,
  resolveGenerate3dModel,
  supportsRigging,
  type Generate3dCapabilities,
  type Generate3dCostLine,
  type Generate3dInputKind,
  type Generate3dLicenseType,
  type Generate3dModelSpec,
} from './model-registry.js';
import { formatTimestamp, packageBaseName } from './package-name.js';
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
  /** fal endpoint id; defaults to {@link DEFAULT_GENERATE_3D_MODEL_ID}. */
  model?: string | undefined;
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
  /** Directory for the package zip and preview; defaults to the directory of `out`. */
  packageDir?: string | undefined;
  /**
   * Extra fal request fields (`--input`), merged over the model adapter's
   * defaults. This is how model-specific fields reach a model the registry does
   * not know, and how a known model's defaults can be overridden.
   */
  extraInput?: Record<string, unknown> | undefined;
  /** True only on the `--dry-run` path; used in the corrected-command hint. */
  dryRun?: boolean | undefined;
  /**
   * The user has seen the priced plan for a real run that rigs or animates.
   * `--dry-run` does not need it; every other run with rigging does.
   */
  confirmCost?: boolean | undefined;
}

/** The reference image the run produced or bundled. */
export interface Generate3dReferenceImageManifest {
  source: 'generated' | 'user-supplied';
  /** Prompt sent to FLUX; null for a user-supplied image. */
  prompt: string | null;
  /** FLUX request id; null for a user-supplied image. */
  requestId: string | null;
  /** The URL handed to the 3D model. */
  url: string | null;
  /** Loose PNG beside `--out` for a generated image; null otherwise. */
  path: string | null;
}

/** The reference image a plan will generate or bundle. */
export interface Generate3dReferenceImagePlan {
  source: 'generated' | 'user-supplied';
  /** Absolute path of the PNG on disk; null for a URL input (not downloaded). */
  localPath: string | null;
  /** Zip entry path; null for a URL input, which is recorded only. */
  zipPath: string | null;
  /** The FLUX request; null when the image is user-supplied. */
  request: GenerateReferenceImageRequest | null;
  /** The prompt the reference image came from; null for a user-supplied image. */
  prompt: string | null;
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
  /** fal catalog licence value, copied verbatim; `unknown` for an unregistered model. */
  licenseType: Generate3dLicenseType;
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
  /**
   * The reference image this run generated or bundled, or absent when the run
   * used no image at all.
   */
  referenceImage?: Generate3dReferenceImageManifest;
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
  /** The bundled reference image, or null when nothing was bundled. */
  referenceImage: {
    source: 'generated' | 'user-supplied';
    prompt: string | null;
    requestId: string | null;
    file: string;
    bytes: number;
    sha256: string;
  } | null;
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
  /** The reference image to generate or bundle; null when no image is used. */
  referenceImage: Generate3dReferenceImagePlan | null;
  costLines: Generate3dCostLine[];
  /** False when the model has no price data, so no total can be honest. */
  generationCostKnown: boolean;
  /** Keys passed with `--input`, in the order given. */
  inputKeys: string[];
  /** A warning about the model id itself, e.g. a near-miss of a registered id. */
  modelWarning?: string | undefined;
  /** True when the caller passed `--confirm-cost`. */
  confirmCost: boolean;
  /** Master file name without its `.glb` suffix; used for the zip entries. */
  stem: string;
  /** Directory the package zip and preview are written to. */
  packageDir: string;
  /** `<stem>-<timestamp>`, the base the zip and the preview share. */
  packageName: string;
  /** `<packageDir>/<packageName>.zip`. */
  zipPath: string;
  /** `<packageDir>/<packageName>.html`. */
  htmlPath: string;
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

/**
 * Resolve `--model` to a spec. There is no allowlist: an id the registry does
 * not know becomes the generic passthrough, and fal validates it.
 */
function requireModel(modelId: string | undefined): Generate3dModelSpec {
  if (modelId === undefined) return resolveGenerate3dModel(DEFAULT_GENERATE_3D_MODEL_ID);
  return resolveGenerate3dModel(requireNonEmpty(modelId, '--model must not be empty.'));
}

/** The flag and value each input kind needs. */
const INPUT_REQUIREMENTS: Record<
  Generate3dInputKind,
  { flag: string; value: (opts: Generate3dOptions) => string | undefined }
> = {
  text: { flag: '--prompt', value: (opts) => opts.prompt },
  image: { flag: '--input-image', value: (opts) => opts.inputImage },
};

/**
 * Require the model's own input flag. A flag the model cannot take is refused
 * earlier by `validateGenerate3dFlags`; this only covers "nothing was passed".
 * A model the registry does not know has no adapter, so its flags pass through.
 */
function requireInputKind(model: Generate3dModelSpec, opts: Generate3dOptions): void {
  const inputKind = model.inputKind;
  if (inputKind === undefined) return;
  // A prompt that becomes a reference image satisfies an image-only model.
  if (needsReferenceImage(model, opts)) return;

  const requirement = INPUT_REQUIREMENTS[inputKind];
  if (isFilled(requirement.value(opts))) return;
  throw new Generate3dError(`${requirement.flag} is required for ${model.id}.`);
}

/** True when an optional input value has real content. */
function isFilled(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
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
  force: boolean,
  hint = 'Pass --force to overwrite.'
): Promise<void> {
  const status = await deps.pathStatus(path);
  if (status === 'directory') {
    throw new Generate3dError(`${label} is a directory: ${path}. Pass a file path.`);
  }
  if (status === 'file' && !force) {
    throw new Generate3dError(`${label} already exists: ${path}. ${hint}`);
  }
}

/**
 * Why a package path can already exist: the base is the out stem plus a
 * second-resolution timestamp, so two runs of the same `--out` in one second
 * collide.
 */
const PACKAGE_COLLISION_HINT =
  'Another run used this name in the same second; wait a second, use a different --package-dir, or pass --force.';

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

/** How the plan labels a model's input; unknown models have none. */
function describeInputKind(inputKind: Generate3dInputKind | undefined): string {
  return inputKind === undefined ? 'input unknown' : `${inputKind}-to-3D`;
}

/**
 * Render the static list-price estimate. The header states the price date and
 * that the figure is not a bill; fal returns no billed cost.
 *
 * A model the registry does not know has no price data, so the block says so
 * and prints no total rather than guessing one.
 */
function formatGenerate3dCost(
  lines: readonly Generate3dCostLine[],
  modelId: string,
  generationCostKnown = true
): string[] {
  if (!generationCostKnown || lines.length === 0) {
    // A total that silently omitted an unpriced component would be a guess.
    return [`Generation cost unknown: no list price for ${modelId}.`];
  }
  return [
    `Cost estimate (prices as of ${GENERATE_3D_PRICES_AS_OF}; estimate; fal returns no billed cost):`,
    ...lines.map((line) => `- ${line.label}`),
    `Estimated total: ${formatUsd(totalUsd(lines))}`,
  ];
}

/**
 * Refuse a real rigging run that has not confirmed the priced plan.
 *
 * A rig adds a Meshy call per clip on top of the mesh, so it needs an explicit
 * acknowledgement. The dry run prints the same plan without this check.
 */
function requireCostConfirmation(plan: Generate3dPlan): void {
  if (plan.riggingRequest === null || plan.confirmCost) return;
  throw new Generate3dError(
    [
      'This run rigs and animates with Meshy 7.1, which is billed in addition to the mesh:',
      ...formatGenerate3dCost(plan.costLines, plan.model.id, plan.generationCostKnown),
      'Add --confirm-cost to run.',
    ].join('\n')
  );
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
  packageDir: string;
  /** `<stem>-<timestamp>`. */
  packageName: string;
  zipPath: string;
  htmlPath: string;
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
 * Resolve the package name and its two paths.
 *
 * Everything is decided before the paid call, so every collision is reported
 * before money is spent.
 */
function resolvePackageNaming(
  opts: Generate3dOptions,
  outPath: string,
  now: Date
): ResolvedPackageNaming {
  const stem = packageStem(outPath);
  const packageDir = resolvePackageDir(outPath, opts.packageDir);
  const packageName = packageBaseName({ stem, timestamp: formatTimestamp(now) });
  return { stem, packageDir, packageName, ...packageFilePaths(packageDir, packageName) };
}

/** Shell-quote one value: bare when it is simple, single-quoted when it is not. */
function shellQuote(value: string): string {
  if (/^[A-Za-z0-9._/:=@+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** One flag the run passed, with everything needed to render it back. */
interface PassedFlag {
  flag: string;
  value?: string | undefined;
  /** Double-quote the value in the "Omit:" list (`--prompt "x"`). */
  quoteInList: boolean;
}

/** Which capability allows each flag. */
const FLAG_CAPABILITY = {
  '--prompt': 'prompt',
  '--input-image': 'image',
  '--rig': 'rig',
  '--animation-action-id': 'rig',
} as const satisfies Record<string, keyof Generate3dCapabilities>;

/** The input flags, for "did the run pass an input the command can keep". */
const INPUT_FLAG_NAMES: readonly string[] = ['--prompt', '--input-image'];

/** The placeholder for a model whose only input is prompt or image. */
const INPUT_PLACEHOLDERS: Record<Generate3dInputKind, string> = {
  text: '--prompt TEXT',
  image: '--input-image PATH_OR_URL',
};

/** Every input and rig flag the run passed, in reporting order. */
function passedFlags(ctx: Generate3dFlagContext): PassedFlag[] {
  const inputs: PassedFlag[] = [
    { flag: '--prompt', value: ctx.prompt, quoteInList: true },
    { flag: '--input-image', value: ctx.inputImage, quoteInList: false },
  ];
  const rig = ctx.rig === true ? [{ flag: '--rig', quoteInList: false }] : [];
  const clips = ctx.animationActionIds.map((id) => ({
    flag: '--animation-action-id',
    value: id,
    quoteInList: false,
  }));
  return [...inputs.filter((entry) => entry.value !== undefined), ...rig, ...clips];
}

/**
 * Whether the model allows one flag. `--prompt` is allowed on an image-only
 * model that generates a reference image from it.
 */
function isAllowed(flag: string, model: Generate3dModelSpec): boolean {
  const capabilities = model.capabilities;
  if (capabilities === undefined) return false;
  if (flag === '--prompt' && model.promptNeedsReferenceImage === true) return true;
  return capabilities[FLAG_CAPABILITY[flag as keyof typeof FLAG_CAPABILITY]] === true;
}

/** A flag as the "Omit:" list writes it. */
function formatFlag(entry: PassedFlag): string {
  if (entry.value === undefined) return entry.flag;
  return entry.quoteInList ? `${entry.flag} "${entry.value}"` : `${entry.flag} ${entry.value}`;
}

/** A flag as a runnable command writes it. */
function formatForCommand(entry: PassedFlag): string {
  if (entry.value === undefined) return entry.flag;
  return `${entry.flag} ${shellQuote(entry.value)}`;
}

/** The passed input the corrected command can keep, if any. */
function keptInput(ctx: Generate3dFlagContext): PassedFlag | undefined {
  return passedFlags(ctx).find(
    (entry) => INPUT_FLAG_NAMES.includes(entry.flag) && isAllowed(entry.flag, ctx.model)
  );
}

/** The capability behind each input kind. */
const INPUT_CAPABILITY: Record<Generate3dInputKind, keyof Generate3dCapabilities> = {
  text: 'prompt',
  image: 'image',
};

/** The placeholder a model needs when no usable input remains. */
function placeholderInput(capabilities: Generate3dCapabilities): string | undefined {
  const kinds = (Object.keys(INPUT_CAPABILITY) as Generate3dInputKind[]).filter(
    (kind) => capabilities[INPUT_CAPABILITY[kind]]
  );
  return kinds.length === 1 ? INPUT_PLACEHOLDERS[kinds[0] as Generate3dInputKind] : undefined;
}

/** The `--prompt` / `--input-image` part of a corrected command. */
function inputParts(ctx: Generate3dFlagContext, capabilities: Generate3dCapabilities): string[] {
  const kept = keptInput(ctx);
  if (kept !== undefined) return [formatForCommand(kept)];
  const placeholder = placeholderInput(capabilities);
  return placeholder === undefined ? [] : [placeholder];
}

/** The `--rig` and clip part of a corrected command. */
function rigParts(ctx: Generate3dFlagContext): string[] {
  return passedFlags(ctx)
    .filter((entry) => !INPUT_FLAG_NAMES.includes(entry.flag))
    .filter((entry) => isAllowed(entry.flag, ctx.model))
    .map(formatForCommand);
}

/** `--out`, `--force`, and `--package-dir`: the same in every corrected command. */
function outputParts(ctx: Generate3dFlagContext): string[] {
  const parts = [`--out ${shellQuote(ctx.out)}`];
  if (ctx.force === true) parts.push('--force');
  if (ctx.packageDir !== undefined) parts.push(`--package-dir ${shellQuote(ctx.packageDir)}`);
  return parts;
}

/** `--dry-run` and `--input`, repeated so the corrected command behaves the same. */
function repeatParts(ctx: Generate3dFlagContext): string[] {
  const dryRun = ctx.dryRun === true ? ['--dry-run'] : [];
  const input =
    ctx.extraInput === undefined ? [] : [`--input ${shellQuote(JSON.stringify(ctx.extraInput))}`];
  return [...dryRun, ...input];
}

/** Rebuild the user's command with the unsupported flags removed. */
function correctedCommand(
  ctx: Generate3dFlagContext,
  capabilities: Generate3dCapabilities
): string {
  return [
    'chatroom',
    'generate-3d',
    '--platform=fal',
    `--model ${ctx.model.id}`,
    ...inputParts(ctx, capabilities),
    ...rigParts(ctx),
    ...outputParts(ctx),
    ...repeatParts(ctx),
  ].join(' ');
}

/** The line telling the user the corrected command still needs an input. */
function inputHint(
  ctx: Generate3dFlagContext,
  capabilities: Generate3dCapabilities
): string | undefined {
  if (keptInput(ctx) !== undefined) return undefined;
  const placeholder = placeholderInput(capabilities);
  if (placeholder === undefined) return undefined;
  return `The corrected command still needs an input: replace ${placeholder.split(' ')[1]} with your value.`;
}

/** The rig flags a refused model was asked for, as typed. */
function rigFlagList(ctx: Generate3dFlagContext): string[] {
  const rig = ctx.rig === true ? ['--rig'] : [];
  return [...rig, ...ctx.animationActionIds.map((id) => `--animation-action-id ${id}`)];
}

/** The Meshy model that matches the input the user already gave. */
function meshyModelFor(ctx: Generate3dFlagContext): string {
  return ctx.inputImage === undefined ? 'meshy/v7.1/text-to-3d' : 'meshy/v7.1/image-to-3d';
}

/** The input flag for the Meshy model, with a placeholder when none was given. */
function meshyInputParts(ctx: Generate3dFlagContext): string[] {
  if (ctx.prompt !== undefined) return [`--prompt ${shellQuote(ctx.prompt)}`];
  if (ctx.inputImage !== undefined) return [`--input-image ${shellQuote(ctx.inputImage)}`];
  return ['--prompt TEXT'];
}

/** The same run against Meshy 7.1, with the rig flags kept and the cost confirmed. */
function meshyRigCommand(ctx: Generate3dFlagContext): string {
  return [
    'chatroom',
    'generate-3d',
    '--platform=fal',
    `--model ${meshyModelFor(ctx)}`,
    ...meshyInputParts(ctx),
    ...rigFlagList(ctx),
    '--confirm-cost',
    ...outputParts(ctx),
    ...repeatParts(ctx),
  ].join(' ');
}

/** The error for rigging (or clips) on a model that Meshy 7.1 does not cover. */
function riggingModelError(ctx: Generate3dFlagContext): Generate3dError {
  const omitted = rigFlagList(ctx).join(', ');
  const lines = [
    `${ctx.model.id} cannot rig. Bones and animation come from Meshy 7.1 only.`,
    `Omit: ${omitted}`,
    'Corrected command:',
    `  ${meshyRigCommand(ctx)}`,
  ];
  if (ctx.prompt === undefined && ctx.inputImage === undefined) {
    lines.push('The corrected command needs a prompt: replace TEXT with your description.');
  }
  return new Generate3dError(lines.join('\n'));
}

/**
 * Rigging and animation are Meshy 7.1 only.
 *
 * This checks the id, not `capabilities.rig`: an unknown model has no capability
 * data, and a missing check must not become permission to spend money.
 */
function validateRigging(ctx: Generate3dFlagContext): void {
  const rigging = ctx.rig === true || ctx.animationActionIds.length > 0;
  if (!rigging || supportsRigging(ctx.model.id)) return;
  throw riggingModelError(ctx);
}

/** The error for unsupported flags: what to omit, and the command that works. */
function flagError(
  ctx: Generate3dFlagContext,
  capabilities: Generate3dCapabilities,
  flags: readonly string[]
): Generate3dError {
  const list = flags.join(', ');
  const lines = [
    `${ctx.model.id} does not support ${list}. Omit: ${list}`,
    'Corrected command:',
    `  ${correctedCommand(ctx, capabilities)}`,
    inputHint(ctx, capabilities),
  ];
  return new Generate3dError(lines.join('\n'));
}

/** Everything the flag check needs: the model, its args, and the run shape. */
interface Generate3dFlagContext {
  model: Generate3dModelSpec;
  prompt?: string | undefined;
  inputImage?: string | undefined;
  rig?: boolean | undefined;
  /** Raw `--animation-action-id` values, exactly as typed. */
  animationActionIds: readonly string[];
  extraInput?: Record<string, unknown> | undefined;
  out: string;
  force?: boolean | undefined;
  packageDir?: string | undefined;
  dryRun?: boolean | undefined;
}

/**
 * Refuse flags a registered model cannot take, before any upload or fal call.
 *
 * The error names every offending flag as typed and includes the same command
 * with those flags removed, so the fix is a copy-paste. A model the registry
 * does not know has no capabilities and is left to fal.
 */
function validateGenerate3dFlags(ctx: Generate3dFlagContext): void {
  const capabilities = ctx.model.capabilities;
  if (capabilities === undefined) return; // unknown model: fal validates the flags

  const flags = passedFlags(ctx)
    .filter((entry) => !isAllowed(entry.flag, ctx.model))
    .map(formatFlag);
  if (flags.length === 0) return;
  throw flagError(ctx, capabilities, flags);
}

/** Parse the clip ids and build the rig half of the plan. */
function planRigging(
  opts: Generate3dOptions,
  outPath: string
): PlannedRigging & { animationActionIds: number[] } {
  const rig = opts.rig === true;
  const animationActionIds = parseAnimationActionIds(opts.animationActionIds ?? []);
  requireRigForClips(rig, animationActionIds);
  return { animationActionIds, ...buildRiggingPlan(outPath, rig, animationActionIds) };
}

/** `--input` keys that the dedicated flags own. */
const RESERVED_INPUT_FLAGS: Record<string, string> = {
  prompt: '--prompt',
  image_url: '--input-image',
};

/**
 * Refuse `--input` keys the dedicated flags own. Silent precedence between
 * `--prompt` and `{"prompt": ...}` would make the request depend on merge order.
 */
function requireReservedInputKeys(extraInput: Record<string, unknown> | undefined): void {
  for (const [key, flag] of Object.entries(RESERVED_INPUT_FLAGS)) {
    if (extraInput !== undefined && key in extraInput) {
      throw new Generate3dError(`--input must not set "${key}"; use ${flag} instead.`);
    }
  }
}

/** A registered id that differs from `id` only by case or punctuation. */
function suggestRegisteredModel(id: string): string | undefined {
  const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = normalize(id);
  return GENERATE_3D_MODELS.map((model) => model.id).find((known) => normalize(known) === target);
}

/** The plan warning for an id that looks like a typo of a registered model. */
function modelWarningFor(model: Generate3dModelSpec): string | undefined {
  if (model.capabilities !== undefined) return undefined;
  const suggestion = suggestRegisteredModel(model.id);
  if (suggestion === undefined) return undefined;
  return `Warning: ${model.id} is not a registered id; did you mean ${suggestion}? It still runs as an unregistered model.`;
}

/** How the plan labels the reference URL before FLUX has produced one. */
const GENERATED_REFERENCE_URL = '<generated reference image URL>';

/**
 * Decide what the reference step does: generate a PNG with FLUX, bundle the
 * user's local file, or record a URL that is never downloaded.
 */
/** The reference step for a prompt on an image-only model. */
function generatedReferencePlan(
  opts: Generate3dOptions,
  outPath: string
): Generate3dReferenceImagePlan {
  const stem = packageStem(outPath);
  return {
    source: 'generated',
    localPath: join(dirname(outPath), `${stem}-reference.png`),
    zipPath: `reference/${stem}-reference.png`,
    request: buildReferenceImageRequest(opts.prompt ?? ''),
    prompt: opts.prompt?.trim() ?? null,
  };
}

/** The reference step for a user-supplied image: bundle a file, record a URL. */
function suppliedReferencePlan(target: Generate3dInputTarget): Generate3dReferenceImagePlan {
  if (target.kind === 'url') {
    return { source: 'user-supplied', localPath: null, zipPath: null, request: null, prompt: null };
  }
  return {
    source: 'user-supplied',
    localPath: target.path,
    zipPath: `reference/${basename(target.path)}`,
    request: null,
    prompt: null,
  };
}

/**
 * Decide what the reference step does: generate a PNG with FLUX, bundle the
 * user's local file, or record a URL that is never downloaded.
 */
function resolveReferenceImagePlan(args: {
  model: Generate3dModelSpec;
  opts: Generate3dOptions;
  outPath: string;
  inputTarget: Generate3dInputTarget | undefined;
}): Generate3dReferenceImagePlan | null {
  if (needsReferenceImage(args.model, args.opts)) {
    return generatedReferencePlan(args.opts, args.outPath);
  }
  if (args.inputTarget === undefined) return null;
  return suppliedReferencePlan(args.inputTarget);
}

/** What the plan hands the model and the sidecar for the reference step. */
interface PlannedReferenceStep {
  referenceImage: Generate3dReferenceImagePlan | null;
  imageUrl: string | undefined;
  inputImage: { source: string; url: string } | null;
  costLines: Generate3dCostLine[];
}

/** The reference step's inputs, paths, and cost line for the plan. */
function planReferenceStep(args: {
  model: Generate3dModelSpec;
  opts: Generate3dOptions;
  outPath: string;
  inputTarget: Generate3dInputTarget | undefined;
}): PlannedReferenceStep {
  const referenceImage = resolveReferenceImagePlan(args);
  if (referenceImage?.source !== 'generated') {
    return {
      referenceImage,
      imageUrl: planInputImageUrl(args.inputTarget),
      inputImage: planInputImageRecord(args.inputTarget),
      costLines: [],
    };
  }
  return {
    referenceImage,
    imageUrl: GENERATED_REFERENCE_URL,
    inputImage: {
      source: referenceImage.localPath ?? GENERATED_REFERENCE_URL,
      url: GENERATED_REFERENCE_URL,
    },
    costLines: [{ label: REFERENCE_IMAGE_COST_LABEL, usd: REFERENCE_IMAGE_COST_USD }],
  };
}

/** Refuse to overwrite the generated reference PNG without `--force`. */
async function requireWritableReference(
  deps: Generate3dDeps,
  reference: Generate3dReferenceImagePlan | null,
  force: boolean
): Promise<void> {
  if (reference?.source !== 'generated' || reference.localPath === null) return;
  await requireWritablePath(deps, reference.localPath, 'Reference image', force);
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

/** Refuse to clobber the package zip or its preview. */
async function requireWritablePackage(
  deps: Generate3dDeps,
  paths: { zipPath: string; htmlPath: string },
  force: boolean
): Promise<void> {
  await requireWritablePath(deps, paths.zipPath, 'Package', force, PACKAGE_COLLISION_HINT);
  await requireWritablePath(deps, paths.htmlPath, 'Preview', force, PACKAGE_COLLISION_HINT);
}

/**
 * Run every preflight check and build the request without a paid call or an
 * upload. The static cost table needs no network, so `--dry-run` works offline
 * and without `FAL_API_KEY`.
 */
/** Resolve the model and run every pure check that needs no filesystem access. */
function resolvePlanTarget(opts: Generate3dOptions): {
  model: Generate3dModelSpec;
  outPath: string;
  flagContext: Generate3dFlagContext;
} {
  const model = requireModel(opts.model);
  const outPath = resolve(requireNonEmpty(opts.out, '--out must not be empty.'));
  requireGlbExtension(outPath);

  const flagContext: Generate3dFlagContext = {
    model,
    prompt: opts.prompt,
    inputImage: opts.inputImage,
    rig: opts.rig === true,
    animationActionIds: opts.animationActionIds ?? [],
    extraInput: opts.extraInput,
    // The user's `--out` as typed, so the corrected command can be re-used.
    out: opts.out,
    force: opts.force,
    packageDir: opts.packageDir,
    dryRun: opts.dryRun,
  };
  validateRigging(flagContext);
  validateGenerate3dFlags(flagContext);
  requireInputKind(model, opts);
  requireReservedInputKeys(opts.extraInput);
  return { model, outPath, flagContext };
}

export async function planGenerate3d(
  opts: Generate3dOptions,
  deps: Generate3dDeps
): Promise<Generate3dPlan> {
  const { model, outPath } = resolvePlanTarget(opts);
  const { animationActionIds, ...rigging } = planRigging(opts, outPath);

  const manifestPath = `${outPath}.json`;
  const inputTarget = await validateInputImage(deps, opts.inputImage);
  const naming = resolvePackageNaming(opts, outPath, deps.now());
  await requireWritablePlanPaths({
    deps,
    force: opts.force === true,
    outPath,
    manifestPath,
    rigging,
    naming,
  });

  const referenceStep = planReferenceStep({ model, opts, outPath, inputTarget });
  await requireWritableReference(deps, referenceStep.referenceImage, opts.force === true);
  const input = model.buildInput({
    prompt: opts.prompt,
    imageUrl: referenceStep.imageUrl,
    extraInput: opts.extraInput,
  });
  return {
    model,
    outPath,
    manifestPath,
    input,
    inputTarget,
    inputImage: referenceStep.inputImage,
    animationActionIds,
    riggedOutPath: rigging.riggedOutPath,
    animationOutPaths: rigging.animationOutPaths,
    riggingRequest: rigging.riggingRequest,
    referenceImage: referenceStep.referenceImage,
    costLines: [
      ...referenceStep.costLines,
      ...(model.cost()?.lines ?? []),
      ...rigging.extraCostLines,
    ],
    generationCostKnown: model.cost() !== undefined,
    inputKeys: Object.keys(opts.extraInput ?? {}),
    modelWarning: modelWarningFor(model),
    confirmCost: opts.confirmCost === true,
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
/** The model line, the input line, and the unknown-model note. */
function planModelLines(plan: Generate3dPlan): string[] {
  const lines = [
    `Model ${plan.model.id} (${describeInputKind(plan.model.inputKind)}, licence: ${plan.model.licenseType})`,
  ];
  const inputLine = formatInputImageLine(plan.inputTarget);
  if (inputLine !== undefined) lines.push(inputLine);
  if (plan.model.inputKind === undefined) {
    lines.push('No capability data; flags are passed through and fal validates them.');
  }
  return lines;
}

/** The reference-image step, when the plan has one. */
function formatReferencePlan(plan: Generate3dPlan): string[] {
  const reference = plan.referenceImage;
  if (reference === null) return [];

  const lines =
    reference.request === null
      ? []
      : [
          'Reference image (FLUX 2 Flash) will be generated first',
          'Reference image request:',
          JSON.stringify(reference.request, null, 2),
        ];
  if (reference.zipPath === null) {
    lines.push('Reference image supplied by URL (recorded in the manifest, not downloaded)');
  } else {
    lines.push(`Reference image ${reference.localPath} (bundled as ${reference.zipPath})`);
  }
  return lines;
}

/** The model-id warning line, when there is one. */
function modelWarningLines(plan: Generate3dPlan): string[] {
  return plan.modelWarning === undefined ? [] : [plan.modelWarning];
}

/** The `--input` caveat for a known model, whose price may move off its defaults. */
function inputNoteLines(plan: Generate3dPlan): string[] {
  if (plan.inputKeys.length === 0 || plan.model.capabilities === undefined) return [];
  return [
    'Estimate assumes model defaults; --input may change the price.',
    `--input keys: ${plan.inputKeys.join(', ')}`,
  ];
}

/** The dry-run pointer to `--confirm-cost` when the plan rigs. */
function confirmationLines(plan: Generate3dPlan): string[] {
  return plan.riggingRequest !== null && !plan.confirmCost ? ['Add --confirm-cost to run.'] : [];
}

export function formatGenerate3dPlan(plan: Generate3dPlan): string {
  return [
    `Would generate ${plan.outPath}`,
    `Manifest ${plan.manifestPath}`,
    `Package ${plan.zipPath}`,
    `Preview ${plan.htmlPath}`,
    ...planModelLines(plan),
    ...modelWarningLines(plan),
    ...formatReferencePlan(plan),
    'Request:',
    JSON.stringify(plan.input, null, 2),
    ...formatRiggingPlan(plan),
    ...inputNoteLines(plan),
    ...formatGenerate3dCost(plan.costLines, plan.model.id, plan.generationCostKnown),
    ...confirmationLines(plan),
    'No upload or fal generation call was made.',
  ].join('\n');
}

/** What the sidecar records about the reference image, when there is one. */
function buildReferenceManifest(
  plan: Generate3dPlan,
  generated: GeneratedReference | null,
  inputImage: { source: string; url: string } | null
): Generate3dReferenceImageManifest | null {
  const reference = plan.referenceImage;
  if (reference === null) return null;
  return {
    source: reference.source,
    prompt: reference.prompt,
    requestId: generated === null ? null : generated.requestId,
    url: inputImage === null ? null : inputImage.url,
    path: reference.localPath,
  };
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
  referenceImage: Generate3dReferenceImageManifest | null;
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
    ...(args.referenceImage === null ? {} : { referenceImage: args.referenceImage }),
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
  reference: Generate3dPackageManifest['referenceImage'];
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
    referenceImage: args.reference,
    licence: args.model.licenseType,
    pricing: {
      // Three decimals keeps a per-mille price such as $0.225 exact while
      // dropping binary-float noise from the sum.
      estimatedTotalUsd: Math.round(args.totalUsd * 1000) / 1000,
      note: PACKAGE_PRICING_NOTE,
    },
  };
}

/**
 * The zip entries. `zipPackage` sorts by path, which fixes the order for a
 * given set of names: `<stem>.glb`, `manifest.json`, `reference/…`,
 * `web/<stem>.web.glb`, and (slice 2) the rigged and clip files.
 */
function buildPackageEntries(args: {
  stem: string;
  masterBytes: Uint8Array;
  webBytes: Uint8Array;
  manifestJson: string;
  reference: { zipPath: string; bytes: Uint8Array } | null;
}): ZipEntry[] {
  return [
    { path: `${args.stem}.glb`, bytes: args.masterBytes },
    { path: `web/${args.stem}.web.glb`, bytes: args.webBytes },
    ...(args.reference === null
      ? []
      : [{ path: args.reference.zipPath, bytes: args.reference.bytes }]),
    { path: PACKAGE_MANIFEST_NAME, bytes: new TextEncoder().encode(args.manifestJson) },
  ];
}

/** Wrap one packaging step so a failure names what was kept. */
function packageFailure(plan: Generate3dPlan, step: string, err: unknown): Generate3dError {
  return new Generate3dError(
    `Failed to ${step}: ${describeError(err)}. The master mesh and manifest are kept: ${plan.outPath}.`
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
    reference: { zipPath: string; bytes: Uint8Array } | null;
  }
): Uint8Array {
  try {
    return deps.zipPackage(
      buildPackageEntries({
        stem: plan.stem,
        masterBytes: args.masterBytes,
        webBytes: args.webBytes,
        manifestJson: JSON.stringify(args.packageManifest, null, 2),
        reference: args.reference,
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
  // A run for the same --out in the same second can only reach here with
  // --force, and the previous pair would otherwise stay beside the new master.
  // Both are removed first, then written fresh.
  if (files.force) {
    await removeQuietly(deps, files.zipPath);
    await removeQuietly(deps, files.htmlPath);
  }

  // Without --force the pair is written exclusively (`wx`), so two runs that
  // race for the same second cannot truncate or interleave each other's files.
  const options = { exclusive: !files.force };

  try {
    await deps.writeFile(files.zipPath, files.zipBytes, options);
  } catch (err) {
    // A failed write can leave a truncated zip; do not keep it.
    const cleanup = await removeQuietly(deps, files.zipPath);
    throw packageFailure(plan, `save the package ${files.zipPath}${cleanup}`, err);
  }

  try {
    await deps.writeFile(files.htmlPath, new TextEncoder().encode(files.html), options);
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
async function writePackage(args: {
  plan: Generate3dPlan;
  deps: Generate3dDeps;
  master: MasterOutput;
  packageName: string;
  paths: PackageOutput;
  prompt: string | undefined;
  force: boolean;
  reference: BundledReference | null;
}): Promise<PackageOutput> {
  const { plan, deps, master, paths, reference } = args;
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
    reference: reference?.manifest ?? null,
  });
  const zipBytes = buildZip(plan, deps, {
    packageManifest,
    masterBytes: master.bytes,
    webBytes: web.bytes,
    reference,
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

/** The reference image a run generated, with the URL the model will use. */
interface GeneratedReference {
  requestId: string;
  inputImage: { source: string; url: string };
  bytes: Uint8Array;
}

/**
 * Run the FLUX reference step: one image call, write the PNG beside `--out`,
 * upload it, and hand the URL to the 3D model.
 *
 * A FLUX failure stops here, before the 3D model runs, so nothing is paid for a
 * mesh that could not be generated.
 */
async function generateReferenceFile(
  plan: Generate3dPlan,
  deps: Generate3dDeps
): Promise<GeneratedReference | null> {
  const reference = plan.referenceImage;
  if (reference === null || reference.request === null || reference.localPath === null) return null;

  const generated = await deps.generateReferenceImage(reference.request);
  await deps.writeFile(reference.localPath, generated.bytes);
  const url = await deps.uploadFile(reference.localPath, 'image/png');
  return {
    requestId: generated.requestId,
    inputImage: { source: reference.localPath, url },
    bytes: generated.bytes,
  };
}

/** The reference image as it goes into the zip, with its manifest entry. */
interface BundledReference {
  zipPath: string;
  bytes: Uint8Array;
  manifest: Generate3dPackageManifest['referenceImage'];
}

/**
 * Load the reference bytes to bundle: the just-generated PNG, or the user's
 * local file. A URL input is recorded in the sidecar and never downloaded, so
 * it is not bundled.
 */
/** The bytes to bundle: the just-generated PNG, or the user's local file. */
async function referenceBytes(
  reference: Generate3dReferenceImagePlan,
  deps: Generate3dDeps,
  generated: GeneratedReference | null
): Promise<Uint8Array | null> {
  if (generated !== null) return generated.bytes;
  if (reference.localPath === null) return null;
  return deps.readFile(reference.localPath);
}

/** The package-manifest entry for a bundled reference image. */
function referenceManifestEntry(args: {
  reference: Generate3dReferenceImagePlan;
  zipPath: string;
  bytes: Uint8Array;
  generated: GeneratedReference | null;
}): NonNullable<Generate3dPackageManifest['referenceImage']> {
  return {
    source: args.reference.source,
    prompt: args.reference.prompt,
    requestId: args.generated === null ? null : args.generated.requestId,
    file: args.zipPath,
    bytes: args.bytes.byteLength,
    sha256: createHash('sha256').update(args.bytes).digest('hex'),
  };
}

async function bundleReference(
  plan: Generate3dPlan,
  deps: Generate3dDeps,
  generated: GeneratedReference | null
): Promise<BundledReference | null> {
  const reference = plan.referenceImage;
  if (reference === null || reference.zipPath === null) return null;

  const zipPath = reference.zipPath;
  const bytes = await referenceBytes(reference, deps, generated);
  if (bytes === null) return null;
  return {
    zipPath,
    bytes,
    manifest: referenceManifestEntry({ reference, zipPath, bytes, generated }),
  };
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
 * Package paths and their collisions are settled in the plan, before this runs;
 * packaging itself waits for the finished master so the master and its
 * provenance survive a packaging failure.
 */
async function generateMaster(
  plan: Generate3dPlan,
  deps: Generate3dDeps,
  opts: Generate3dOptions,
  reference: GeneratedReference | null = null
): Promise<MasterOutput> {
  // Preflight before the paid call: create the output and package directories so
  // a successful generation cannot fail on a missing one.
  await deps.ensureParentDir(plan.outPath);
  await deps.ensureParentDir(plan.zipPath);

  const inputImage = reference?.inputImage ?? (await uploadInputImage(deps, plan.inputTarget));
  const input = plan.model.buildInput({
    prompt: opts.prompt,
    imageUrl: inputImage?.url,
    extraInput: opts.extraInput,
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
    referenceImage: buildReferenceManifest(plan, reference, inputImage),
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
/** Build and write the package, returning its failure instead of throwing it. */
async function packageOrError(args: {
  plan: Generate3dPlan;
  deps: Generate3dDeps;
  master: MasterOutput;
  prompt: string | undefined;
  force: boolean;
  reference: BundledReference | null;
}): Promise<Generate3dError | null> {
  try {
    await writePackage({
      plan: args.plan,
      deps: args.deps,
      master: args.master,
      packageName: args.plan.packageName,
      paths: { zipPath: args.plan.zipPath, htmlPath: args.plan.htmlPath },
      prompt: args.prompt,
      force: args.force,
      reference: args.reference,
    });
    return null;
  } catch (err) {
    return err instanceof Generate3dError ? err : new Generate3dError(describeError(err));
  }
}

/** The sidecar with the package files linked. */
function withPackageLink(manifest: Generate3dManifest, plan: Generate3dPlan): Generate3dManifest {
  return {
    ...manifest,
    package: { zip: basename(plan.zipPath), html: basename(plan.htmlPath) },
  };
}

/** Run the rig when asked; returns whether it completed. */
async function rigIfRequested(args: {
  plan: Generate3dPlan;
  deps: Generate3dDeps;
  master: MasterOutput;
  manifest: Generate3dManifest;
}): Promise<boolean> {
  if (args.plan.riggingRequest === null) return false;
  const rigging = await runRigging(args.plan, args.deps, args.master.glbUrl);
  await args.deps.writeJson(args.plan.manifestPath, { ...args.manifest, rigging });
  return true;
}

/** A packaging failure that records whether the rig still ran. */
function rigAwarePackageError(err: Generate3dError, rigged: boolean): Generate3dError {
  if (!rigged) return err;
  return new Generate3dError(`${err.message} The rig completed and was saved.`);
}

export async function generate3d(
  opts: Generate3dOptions,
  deps: Generate3dDeps
): Promise<Generate3dResult> {
  requireFalKey(deps);
  const plan = await planGenerate3d(opts, deps);
  // Before the upload and the paid call: a rig needs the priced plan confirmed.
  requireCostConfirmation(plan);
  const reference = await generateReferenceFile(plan, deps);
  const bundledReference = await bundleReference(plan, deps, reference);
  const master = await generateMaster(plan, deps, opts, reference);

  // Package first: it is a pure function of the master, so a rig failure cannot
  // cost the user the package. A packaging failure is held so the rig can still
  // run and be saved before the error surfaces.
  const packageError = await packageOrError({
    plan,
    deps,
    master,
    prompt: opts.prompt,
    force: opts.force === true,
    reference: bundledReference,
  });
  const manifest = packageError === null ? withPackageLink(master.manifest, plan) : master.manifest;
  if (packageError === null) await deps.writeJson(plan.manifestPath, manifest);

  const rigged = await rigIfRequested({ plan, deps, master, manifest });
  if (packageError !== null) throw rigAwarePackageError(packageError, rigged);

  return {
    outPath: plan.outPath,
    manifestPath: plan.manifestPath,
    zipPath: plan.zipPath,
    htmlPath: plan.htmlPath,
    sha256: master.sha256,
    costLines: formatGenerate3dCost(plan.costLines, plan.model.id, plan.generationCostKnown),
  };
}
