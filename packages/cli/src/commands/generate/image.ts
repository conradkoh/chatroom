/**
 * Generate Image — pure logic for `chatroom generate-image`.
 *
 * Generates one image through an injected fal subscriber, writes the bytes to
 * `out`, and writes a JSON sidecar manifest to `<out>.json`. No SDK, network,
 * clock, or filesystem access is imported here; all of it arrives through
 * `GenerateImageDeps`, so the unit tests run fully offline.
 */

import { createHash } from 'node:crypto';
import { extname, resolve } from 'node:path';

import type { FalImageResult, GenerateImageDeps } from './deps.js';
import {
  formatCostDisclosure,
  formatCostEstimate,
  imageSizeMegapixels,
  lookupUnitPrice,
  type FalCostDisclosure,
  type FalUnitPrice,
} from './fal-pricing.js';
import { readPngDimensions } from './local-image-common.js';
import {
  describeConstraints,
  FLUX_2_FLASH_EDIT_MODEL,
  getModelCapability,
  type ConstraintDisclosure,
  type ModelCapability,
} from './model-capabilities.js';

/**
 * Generation platforms the CLI can call today. New platforms are added here
 * and dispatched in `generateImage`; the flag and manifest field already exist
 * so adding one does not change the command shape.
 */
export const GENERATE_IMAGE_PLATFORMS = ['fal'] as const;
export type GenerateImagePlatform = (typeof GENERATE_IMAGE_PLATFORMS)[number];
export const DEFAULT_GENERATE_IMAGE_PLATFORM: GenerateImagePlatform = 'fal';

export type ImageOutputFormat = 'png' | 'webp';

/**
 * Error type for generate-image failures. Messages may name the request id and
 * result URL (so a paid result can be recovered) but never the API key.
 */
export class GenerateImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerateImageError';
  }
}

export interface GenerateImageOptions {
  prompt: string;
  out: string;
  platform?: GenerateImagePlatform | undefined;
  /** Required fal model id; the command has no default model. */
  model: string;
  aspectRatio?: string | undefined;
  outputFormat?: ImageOutputFormat | undefined;
  seed?: number | undefined;
  /** Model-specific fal input merged into the request body. */
  input?: Record<string, unknown> | undefined;
  /** Local image path or public http(s) URL to edit with the edit model. */
  inputImage?: string | undefined;
  /** Allow replacing an existing output or manifest file. */
  force?: boolean | undefined;
}

export interface GenerateImageResult {
  outPath: string;
  manifestPath: string;
  sha256: string;
  /** Cost lines for the CLI to print after the output paths. */
  costLines: string[];
}

/**
 * What the CLI can say about cost. `quantity` is absent when the planned image
 * size is unknown; `price` is absent when the model has no rate data.
 */
export interface GenerateImageCost {
  price: FalUnitPrice | undefined;
  quantity: number | undefined;
  quantityLabel: string | undefined;
  /**
   * Input megapixels for the edit formula. fal resizes the input to 1 MP, so
   * this is always 1 for edit models and absent for text-to-image models.
   */
  inputMegapixels: number | undefined;
  /** Why the quantity is not estimated, when it is not. */
  reason: string | undefined;
  /** Command-specific explanation printed under the cost line. */
  notes: string[];
}

/** Sidecar manifest written next to the generated image. */
export interface GenerateImageManifest {
  platform: GenerateImagePlatform;
  tool: 'chatroom generate-image';
  sdk: string;
  model: string;
  input: Record<string, unknown>;
  /** Source given by the user and the URL sent to fal; null without --input-image. */
  inputImage: { source: string; url: string } | null;
  requestId: string | null;
  seed: number | null;
  output: {
    path: string;
    sha256: string;
    contentType: string | null;
    bytes: number;
  };
  generatedAt: string;
  licensing: 'unverified';
}

/**
 * fal's terms do not expressly grant commercial rights to outputs, so every
 * manifest records `unverified` until a human confirms the licence.
 */
const LICENSING = 'unverified' as const;

export const FAL_API_KEY_MISSING_MESSAGE =
  'FAL_API_KEY is not set. Set FAL_API_KEY in your environment to generate images with fal. (FAL_KEY_ID/FAL_KEY_SECRET are not supported by this command.)';

/** File extensions we can reason about when validating --output-format. */
const EXTENSION_FORMATS: Record<string, ImageOutputFormat> = {
  '.png': 'png',
  '.webp': 'webp',
};

/** Formats the command no longer writes, even if the model supports them. */
const UNSUPPORTED_OUTPUT_EXTENSIONS = new Set(['.jpg', '.jpeg']);

function resolvePlatform(platform: GenerateImagePlatform | undefined): GenerateImagePlatform {
  return platform ?? DEFAULT_GENERATE_IMAGE_PLATFORM;
}

/**
 * The single platform dispatch point. Only platforms listed in
 * `GENERATE_IMAGE_PLATFORMS` are wired; adding one starts here.
 */
function requireSupportedPlatform(platform: GenerateImagePlatform): void {
  if (!GENERATE_IMAGE_PLATFORMS.includes(platform)) {
    throw new Error(`unsupported platform: ${platform}`);
  }
}

/** fal has no keyless path: fail before any validation or network call. */
function requireFalKey(deps: GenerateImageDeps): void {
  if (!deps.env.FAL_API_KEY) {
    throw new Error(FAL_API_KEY_MISSING_MESSAGE);
  }
}

function requireNonEmpty(value: string, message: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(message);
  }
  return trimmed;
}

const INPUT_DEDICATED_FLAGS: Record<string, string> = {
  prompt: '--prompt',
  seed: '--seed',
  output_format: '--output-format',
  aspect_ratio: '--aspect-ratio',
  image_urls: '--input-image',
};

/**
 * Content types for the input image extensions the edit model accepts. The
 * type is derived from the extension and sent with the upload; bytes are never
 * sniffed.
 */
const INPUT_IMAGE_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/** Content type for a supported input image extension, or a clear error. */
function inputImageContentType(path: string): string {
  const extension = extname(path).toLowerCase();
  const contentType = INPUT_IMAGE_CONTENT_TYPES[extension];
  if (contentType === undefined) {
    throw new GenerateImageError(
      `Unsupported --input-image extension ${extension || '(none)'}. Use one of: ${Object.keys(INPUT_IMAGE_CONTENT_TYPES).join(', ')}.`
    );
  }
  return contentType;
}

const HTTP_URL_PATTERN = /^https?:\/\//i;

/**
 * Validate model-specific input without knowing any model's schema. Only keys
 * that collide with dedicated flags (or the unsupported sync_mode) are refused.
 */
// fallow-ignore-next-line complexity
function validateInputObject(input: Record<string, unknown>): void {
  if ('sync_mode' in input && input.sync_mode !== undefined) {
    throw new GenerateImageError(
      '--input must not contain "sync_mode": it returns data URIs that this command cannot download. Omit it.'
    );
  }
  if ('num_images' in input && input.num_images !== undefined && input.num_images !== 1) {
    throw new GenerateImageError('--input num_images must be 1; extra images are not saved.');
  }
  for (const [key, flag] of Object.entries(INPUT_DEDICATED_FLAGS)) {
    if (key in input && input[key] !== undefined) {
      throw new GenerateImageError(`--input must not contain "${key}"; use ${flag} instead.`);
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse `--input` inline JSON and require a plain object. */
export function parseInputJson(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new GenerateImageError('--input must be valid JSON.');
  }
  if (!isPlainObject(parsed)) {
    throw new GenerateImageError('--input must be a JSON object.');
  }
  validateInputObject(parsed);
  return parsed;
}

/**
 * Only send the fields the user actually passed. Model defaults differ (for
 * example some models reject `auto` aspect ratios or have no aspect ratio at
 * all), so the manifest records exactly what went over the wire.
 */
// fallow-ignore-next-line complexity
function buildInput(
  prompt: string,
  opts: GenerateImageOptions,
  imageUrl: string | undefined
): Record<string, unknown> {
  return {
    prompt,
    ...(opts.input ?? {}),
    ...(opts.aspectRatio !== undefined ? { aspect_ratio: opts.aspectRatio } : {}),
    ...(opts.outputFormat !== undefined ? { output_format: opts.outputFormat } : {}),
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    ...(imageUrl !== undefined ? { image_urls: [imageUrl] } : {}),
  };
}

/** Validate `--input` before any filesystem or network work. */
function validateInputOption(opts: GenerateImageOptions): void {
  if (opts.input === undefined) return;
  if (!isPlainObject(opts.input)) {
    throw new GenerateImageError('--input must be a JSON object.');
  }
  validateInputObject(opts.input);
}

/** The first image of a fal result, or a clear error when the model returned none. */
function requireImage(
  images: FalImageResult['data']['images'],
  model: string
): FalImageResult['data']['images'][number] {
  const image = images[0];
  if (!image?.url) {
    throw new GenerateImageError(`fal returned no image for model ${model}`);
  }
  return image;
}

/**
 * Refuse to clobber an existing file or write over a directory unless the user
 * asked with --force. Runs before the paid fal call.
 */
async function requireWritablePath(
  deps: GenerateImageDeps,
  path: string,
  label: string,
  force: boolean
): Promise<void> {
  const status = await deps.pathStatus(path);
  if (status === 'directory') {
    throw new GenerateImageError(`${label} is a directory: ${path}. Pass a file path.`);
  }
  if (status === 'file' && !force) {
    throw new GenerateImageError(`${label} already exists: ${path}. Pass --force to overwrite.`);
  }
}

async function requireWritableOutput(
  deps: GenerateImageDeps,
  outPath: string,
  manifestPath: string,
  force: boolean
): Promise<void> {
  await requireWritablePath(deps, outPath, '--out', force);
  await requireWritablePath(deps, manifestPath, 'Manifest', force);
}

/**
 * Failures after a successful (paid) generation still name the request id and
 * image URL so the result can be recovered manually.
 */
function recoveryMessage(action: string, err: unknown, requestId: string, url: string): string {
  const detail = err instanceof Error ? err.message : String(err);
  return `Failed to ${action} generated image for request ${requestId} (${url}): ${detail}. The generated image can still be recovered from that URL.`;
}

async function downloadImage(
  deps: GenerateImageDeps,
  requestId: string,
  url: string
): Promise<Uint8Array> {
  try {
    return await deps.fetchBytes(url);
  } catch (err) {
    throw new GenerateImageError(recoveryMessage('download', err, requestId, url));
  }
}

async function saveImage(
  deps: GenerateImageDeps,
  outPath: string,
  bytes: Uint8Array,
  requestId: string,
  url: string
): Promise<void> {
  try {
    await deps.writeFile(outPath, bytes);
  } catch (err) {
    throw new GenerateImageError(recoveryMessage('save', err, requestId, url));
  }
}

/**
 * JPEG cannot carry transparency, so the command refuses it outright: writing a
 * model-default PNG to a .jpg path would mislabel the file. Unknown extensions
 * are still left alone, matching the format check below.
 */
function requireSupportedExtension(outPath: string): void {
  const extension = extname(outPath).toLowerCase();
  if (!UNSUPPORTED_OUTPUT_EXTENSIONS.has(extension)) return;
  throw new GenerateImageError(
    `Unsupported output extension ${extension}. Use .png or .webp (transparency-capable).`
  );
}

/**
 * A mismatched extension makes the file claim to be a format it is not, so
 * reject it before the paid call. Unknown extensions are left alone.
 *
 * Combined with resolveSeed below, this relies on --input being unable to carry
 * output_format or seed: buildInput refuses both, so the dedicated flags remain
 * the only source for the extension check and the recorded seed.
 */
function requireFormatMatchesExtension(outPath: string, format: ImageOutputFormat): void {
  const extension = extname(outPath).toLowerCase();
  const expected = EXTENSION_FORMATS[extension];
  if (expected !== undefined && expected !== format) {
    throw new GenerateImageError(
      `--output-format ${format} does not match the --out extension ${extension}. Use --output-format ${expected} or rename the output.`
    );
  }
}

/** Prefer the seed fal resolved; fall back to the requested seed. */ function resolveSeed(
  resultSeed: number | undefined,
  requestedSeed: number | undefined
): number | null {
  return resultSeed ?? requestedSeed ?? null;
}

function buildManifest(args: {
  platform: GenerateImagePlatform;
  model: string;
  input: Record<string, unknown>;
  inputImage: { source: string; url: string } | null;
  requestId: string | undefined;
  resultSeed: number | undefined;
  requestedSeed: number | undefined;
  outPath: string;
  sha256: string;
  contentType: string | undefined;
  byteLength: number;
  generatedAt: string;
  sdkVersion: string;
}): GenerateImageManifest {
  return {
    platform: args.platform,
    tool: 'chatroom generate-image',
    sdk: `@fal-ai/client@${args.sdkVersion}`,
    model: args.model,
    input: args.input,
    inputImage: args.inputImage,
    requestId: args.requestId ?? null,
    seed: resolveSeed(args.resultSeed, args.requestedSeed),
    output: {
      path: args.outPath,
      sha256: args.sha256,
      contentType: args.contentType ?? null,
      bytes: args.byteLength,
    },
    generatedAt: args.generatedAt,
    licensing: LICENSING,
  };
}

// fallow-ignore-next-line complexity
function requireTaskPairing(
  capability: ModelCapability,
  model: string,
  inputImage: string | undefined
): void {
  if (capability.task === 'image-edit' && inputImage === undefined) {
    throw new GenerateImageError(`${model} edits an image; pass --input-image <path-or-url>.`);
  }
  if (capability.task === 'text-to-image' && inputImage !== undefined) {
    throw new GenerateImageError(
      `${model} does not take an input image; use --model ${FLUX_2_FLASH_EDIT_MODEL} with --input-image.`
    );
  }
}

function requireAspectRatioSupport(
  capability: ModelCapability,
  model: string,
  aspectRatio: string | undefined
): void {
  if (aspectRatio === undefined) return;
  const support = capability.params.aspect_ratio;
  if (support?.support !== 'unsupported') return;
  throw new GenerateImageError(`--aspect-ratio is not supported by ${model}. ${support.reason}`);
}

/**
 * Refuse known model/flag mismatches before any file I/O or network call.
 * Unknown model ids are passed through unchanged, matching the CLI's promise
 * to forward arbitrary fal models.
 */
function requireModelPairing(
  model: string,
  inputImage: string | undefined,
  aspectRatio: string | undefined
): void {
  const capability = getModelCapability(model);
  if (capability === undefined) return;
  requireTaskPairing(capability, model, inputImage);
  requireAspectRatioSupport(capability, model, aspectRatio);
}

/** Trim `--input-image`, or return undefined when the flag is absent. */
function resolveInputImageOption(opts: GenerateImageOptions): string | undefined {
  return opts.inputImage === undefined
    ? undefined
    : requireNonEmpty(opts.inputImage, '--input-image must not be empty.');
}

/** A validated input image: a public URL or a local file waiting to be uploaded. */
export type InputImageTarget =
  { kind: 'url'; url: string } | { kind: 'file'; path: string; contentType: string };

/** The request the CLI would send, plus the pending upload and disclosures. */
export interface GenerateImagePlan {
  platform: GenerateImagePlatform;
  model: string;
  outPath: string;
  manifestPath: string;
  /** Request body; a local input image shows a storage placeholder. */
  input: Record<string, unknown>;
  inputTarget: InputImageTarget | undefined;
  disclosures: ConstraintDisclosure[];
  /** Estimated fal cost and its provenance; never a billed amount. */
  cost: GenerateImageCost;
}

interface PreparedInputImage {
  /** The single value sent to fal in `image_urls`, or undefined without --input-image. */
  url: string | undefined;
  /** What the manifest records for provenance, or null without --input-image. */
  record: { source: string; url: string } | null;
}

/**
 * Validate the input image before the output directory is created. The
 * extension is checked before pathStatus so unsupported formats fail without
 * touching disk; the upload itself happens later, after every other preflight.
 */
async function validateInputImage(
  deps: GenerateImageDeps,
  inputImage: string | undefined
): Promise<InputImageTarget | undefined> {
  if (inputImage === undefined) return undefined;
  if (HTTP_URL_PATTERN.test(inputImage)) return { kind: 'url', url: inputImage };
  const localPath = resolve(inputImage);
  const contentType = inputImageContentType(localPath);
  const status = await deps.pathStatus(localPath);
  if (status !== 'file') {
    throw new GenerateImageError(`--input-image is not a file: ${localPath}`);
  }
  return { kind: 'file', path: localPath, contentType };
}

/** The value shown for image_urls before a local file is uploaded. */
function planInputImageUrl(target: InputImageTarget | undefined): string | undefined {
  if (target === undefined) return undefined;
  return target.kind === 'url' ? target.url : `<fal storage URL for ${target.path}>`;
}

/** Upload a validated local file, if any, and return the value for image_urls. */
async function uploadInputImage(
  deps: GenerateImageDeps,
  target: InputImageTarget | undefined
): Promise<PreparedInputImage> {
  if (target === undefined) return { url: undefined, record: null };
  if (target.kind === 'url') {
    return { url: target.url, record: { source: target.url, url: target.url } };
  }
  const url = await deps.uploadFile(target.path, target.contentType);
  return { url, record: { source: target.path, url } };
}

const PLANNED_COST_NOTE =
  'fal returns no billed cost; this is computed from the planned image size.';
const ACTUAL_COST_NOTE = 'fal returns no billed cost; check the fal dashboard for the actual bill.';

/** Two decimal places is enough for a size; the cost itself is never rounded. */
function formatMegapixels(megapixels: number): string {
  return `${megapixels.toFixed(2)} MP`;
}

// fallow-ignore-next-line complexity
function readImageSizeValue(
  value: unknown
): string | { width: number; height: number } | undefined {
  if (typeof value === 'string') return value;
  if (isPlainObject(value) && typeof value.width === 'number' && typeof value.height === 'number') {
    return { width: value.width, height: value.height };
  }
  return undefined;
}

interface PlannedOutputSize {
  megapixels: number | undefined;
  reason: string | undefined;
}

/**
 * Output megapixels from `image_size`, or the model's documented default. An
 * unset size with no default, or a preset the CLI does not know, yields no
 * estimate rather than a guessed one.
 */
// fallow-ignore-next-line complexity
function plannedOutputSize(model: string, input: Record<string, unknown>): PlannedOutputSize {
  const capability = getModelCapability(model);
  const support = capability?.params.image_size;
  const value =
    input.image_size !== undefined
      ? input.image_size
      : support?.support === 'supported'
        ? support.default
        : undefined;
  if (value === undefined) {
    return {
      megapixels: undefined,
      reason:
        'The image_size is unset and the model has no known default; output size not estimated.',
    };
  }
  const size = readImageSizeValue(value);
  if (size === undefined) {
    return {
      megapixels: undefined,
      reason: `The image_size ${JSON.stringify(value)} is not a preset name or {width,height}; output size not estimated.`,
    };
  }
  const megapixels = imageSizeMegapixels(size);
  if (megapixels === undefined) {
    return {
      megapixels: undefined,
      reason: `The image_size ${JSON.stringify(value)} is not a known preset; output size not estimated.`,
    };
  }
  return { megapixels, reason: undefined };
}

/**
 * fal's edit model resizes the input image to 1 MP, so the estimate always
 * counts 1 MP of input regardless of the source's real dimensions.
 */
const EDIT_INPUT_MEGAPIXELS = 1;
const EDIT_INPUT_NOTE =
  'fal resizes the input image to 1 MP; the estimate counts 1 MP of input regardless of its dimensions.';

/**
 * Informational only: fal always bills the edit input as 1 MP, so the source
 * dimensions are reported for context but never used in the quantity.
 */
// fallow-ignore-next-line complexity
async function inputSizeNote(
  deps: GenerateImageDeps,
  target: InputImageTarget | undefined
): Promise<string> {
  if (target === undefined) return EDIT_INPUT_NOTE;
  if (target.kind === 'url') {
    return 'Input is a URL; fal resizes it to 1 MP, so the estimate counts 1 MP of input.';
  }
  if (target.contentType !== 'image/png') {
    return 'Input is not a PNG; fal resizes it to 1 MP, so the estimate counts 1 MP of input.';
  }
  try {
    const dimensions = readPngDimensions(await deps.readFileBytes(target.path));
    if (dimensions === null || dimensions.width === 0 || dimensions.height === 0) {
      return EDIT_INPUT_NOTE;
    }
    const megapixels = (dimensions.width * dimensions.height) / 1_000_000;
    return `Input is ${dimensions.width}x${dimensions.height} (${formatMegapixels(megapixels)}); fal resizes it to 1 MP, so the estimate counts 1 MP of input.`;
  } catch {
    return EDIT_INPUT_NOTE;
  }
}

/**
 * Pricing failure must never block a plan or a generation. A rejecting lookup
 * falls back to the list price rather than dropping to "unknown".
 */
async function lookupPrice(
  deps: GenerateImageDeps,
  model: string
): Promise<FalUnitPrice | undefined> {
  return lookupUnitPrice(model, (ids) => deps.lookupPrices(ids));
}

/**
 * Build the pre-call estimate. The rate comes from fal's pricing lookup; the
 * quantity comes from the planned output size plus the edit model's fixed
 * 1 MP input. The edit formula is flagged unverified against a billing line.
 */
// fallow-ignore-next-line complexity
async function buildGenerateImageCost(args: {
  model: string;
  input: Record<string, unknown>;
  inputTarget: InputImageTarget | undefined;
  deps: GenerateImageDeps;
}): Promise<GenerateImageCost> {
  const price = await lookupPrice(args.deps, args.model);
  const output = plannedOutputSize(args.model, args.input);
  const capability = getModelCapability(args.model);

  if (capability?.task === 'image-edit') {
    const notes = [
      'Formula (unverified): (1 MP input + output MP) × rate.',
      await inputSizeNote(args.deps, args.inputTarget),
    ];
    if (output.megapixels === undefined) {
      return {
        price,
        quantity: undefined,
        quantityLabel: undefined,
        inputMegapixels: EDIT_INPUT_MEGAPIXELS,
        reason: output.reason,
        notes,
      };
    }
    const quantity = EDIT_INPUT_MEGAPIXELS + output.megapixels;
    return {
      price,
      quantity,
      quantityLabel: `${formatMegapixels(quantity)} (${formatMegapixels(EDIT_INPUT_MEGAPIXELS)} input + ${formatMegapixels(output.megapixels)} output)`,
      inputMegapixels: EDIT_INPUT_MEGAPIXELS,
      reason: undefined,
      notes,
    };
  }

  if (output.megapixels === undefined) {
    return {
      price,
      quantity: undefined,
      quantityLabel: undefined,
      inputMegapixels: undefined,
      reason: output.reason,
      notes: [],
    };
  }
  return {
    price,
    quantity: output.megapixels,
    quantityLabel: `${formatMegapixels(output.megapixels)} (planned output)`,
    inputMegapixels: undefined,
    reason: undefined,
    notes: [],
  };
}

/**
 * Render the cost lines for a plan or an actual result. The first line carries
 * the arithmetic; the note explains that the figure is not a bill.
 */
// fallow-ignore-next-line complexity
function formatGenerateImageCost(
  cost: GenerateImageCost,
  model: string,
  label: 'Cost' | 'Estimated cost' = 'Cost'
): string[] {
  const disclosure: FalCostDisclosure =
    cost.price === undefined
      ? { kind: 'unknown', model }
      : cost.quantity === undefined
        ? {
            kind: 'rate-only',
            model,
            price: cost.price,
            reason: cost.reason ?? 'Quantity not estimated.',
          }
        : {
            kind: 'estimate',
            model,
            price: cost.price,
            quantity: cost.quantity,
            quantityLabel: cost.quantityLabel ?? formatMegapixels(cost.quantity),
          };
  const note =
    cost.price === undefined
      ? []
      : [cost.quantity === undefined ? ACTUAL_COST_NOTE : PLANNED_COST_NOTE];
  return [formatCostDisclosure(disclosure, label), ...note, ...cost.notes];
}

/**
 * Recompute the estimate from the dimensions fal actually returned. Falls back
 * to the planned estimate when the result carries no dimensions.
 */
// fallow-ignore-next-line complexity
function actualCostLines(
  plan: GenerateImagePlan,
  image: { width?: number | undefined; height?: number | undefined }
): string[] {
  const { price, inputMegapixels } = plan.cost;
  if (price === undefined) {
    return formatGenerateImageCost(plan.cost, plan.model, 'Estimated cost');
  }
  const width = image.width;
  const height = image.height;
  const hasDimensions =
    width !== undefined &&
    height !== undefined &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0;
  if (!hasDimensions) {
    if (plan.cost.quantity === undefined) {
      return formatGenerateImageCost(plan.cost, plan.model, 'Estimated cost');
    }
    return [
      `Estimated cost (planned size): ${formatCostEstimate(price, plan.cost.quantity, plan.cost.quantityLabel ?? formatMegapixels(plan.cost.quantity))}`,
      ACTUAL_COST_NOTE,
    ];
  }
  // MP = width × height / 1,000,000. fal's divisor is undocumented; this may
  // overstate 1024-based sizes by ~5%, which is the safe direction.
  const outputMegapixels = (width * height) / 1_000_000;
  const quantity =
    inputMegapixels === undefined ? outputMegapixels : inputMegapixels + outputMegapixels;
  const quantityLabel =
    inputMegapixels === undefined
      ? `${formatMegapixels(outputMegapixels)} (actual ${width}x${height})`
      : `${formatMegapixels(quantity)} (actual ${width}x${height}; ${formatMegapixels(inputMegapixels)} input + ${formatMegapixels(outputMegapixels)} output)`;
  return [
    `Estimated cost: ${formatCostEstimate(price, quantity, quantityLabel)}`,
    ACTUAL_COST_NOTE,
  ];
}

/**
 * Run every preflight check and build the request without a paid call. The
 * plan performs no upload and no fal generation request, but it may make one
 * read-only pricing request when `FAL_API_KEY` is set. Without the key it makes
 * no network call, so `--dry-run` still works offline.
 */
export async function planGenerateImage(
  opts: GenerateImageOptions,
  deps: GenerateImageDeps
): Promise<GenerateImagePlan> {
  const platform = resolvePlatform(opts.platform);
  // Pure check: reject an unwired platform before touching the environment or network.
  requireSupportedPlatform(platform);

  const model = requireNonEmpty(opts.model, '--model must not be empty.');
  const prompt = requireNonEmpty(opts.prompt, '--prompt must not be empty.');
  const outPath = resolve(requireNonEmpty(opts.out, '--out must not be empty.'));
  requireSupportedExtension(outPath);
  if (opts.outputFormat !== undefined) {
    requireFormatMatchesExtension(outPath, opts.outputFormat);
  }
  const inputImage = resolveInputImageOption(opts);
  requireModelPairing(model, inputImage, opts.aspectRatio);
  validateInputOption(opts);
  const inputTarget = await validateInputImage(deps, inputImage);
  const manifestPath = `${outPath}.json`;

  // Refuse unwritable outputs before the paid call.
  await requireWritableOutput(deps, outPath, manifestPath, opts.force === true);

  const input = buildInput(prompt, opts, planInputImageUrl(inputTarget));
  const cost = await buildGenerateImageCost({ model, input, inputTarget, deps });
  return {
    platform,
    model,
    outPath,
    manifestPath,
    input,
    inputTarget,
    disclosures: describeConstraints(model, input, { aspectRatio: opts.aspectRatio }),
    cost,
  };
}

/** A flag name for a disclosure key, used in dry-run output. */
function disclosureFlag(key: string): '--aspect-ratio' | '--input' {
  return key === 'aspect_ratio' ? '--aspect-ratio' : '--input';
}

function formatDisclosure(disclosure: ConstraintDisclosure): string {
  if (disclosure.kind === 'unsupported' || disclosure.kind === 'unknown') {
    return `- ${disclosure.kind}: ${disclosure.key} (${disclosureFlag(disclosure.key)}) — ${disclosure.message}`;
  }
  return `- ${disclosure.kind}: ${disclosure.message}`;
}

function formatInputImageLine(target: InputImageTarget | undefined): string | undefined {
  if (target === undefined) return undefined;
  return target.kind === 'url'
    ? `Input image ${target.url} (passed through)`
    : `Input image ${target.path} (would be uploaded to fal storage, 1-day lifetime)`;
}

/** Render a plan for `--dry-run`: paths, request, and known constraints. */
export function formatGenerateImagePlan(plan: GenerateImagePlan): string {
  const capability = getModelCapability(plan.model);
  const lines = [
    `Would generate ${plan.outPath}`,
    `Manifest ${plan.manifestPath}`,
    capability === undefined
      ? `Model ${plan.model} (no capability data)`
      : `Model ${plan.model} (${capability.name}, ${capability.task})`,
  ];
  const inputLine = formatInputImageLine(plan.inputTarget);
  if (inputLine !== undefined) lines.push(inputLine);
  lines.push('Request:', JSON.stringify(plan.input, null, 2), 'Constraints:');
  for (const disclosure of plan.disclosures) lines.push(formatDisclosure(disclosure));
  lines.push(...formatGenerateImageCost(plan.cost, plan.model));
  lines.push('No upload or fal generation call was made.');
  return lines.join('\n');
}

/** A completed generation whose bytes are already written to `outPath`. */
interface SavedGeneration {
  image: FalImageResult['data']['images'][number];
  bytes: Uint8Array;
  sha256: string;
  requestId: string;
  seed: number | undefined;
}

/** Call fal once, then download and save the first image it returned. */
async function generateAndSave(
  deps: GenerateImageDeps,
  model: string,
  input: Record<string, unknown>,
  outPath: string
): Promise<SavedGeneration> {
  const result = await deps.falSubscribe(model, input);
  if (result.data.images.length > 1) {
    deps.warn(`⚠️ fal returned ${result.data.images.length} images; only the first is saved.`);
  }
  const image = requireImage(result.data.images, model);

  const bytes = await downloadImage(deps, result.requestId, image.url);
  await saveImage(deps, outPath, bytes, result.requestId, image.url);
  return {
    image,
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    requestId: result.requestId,
    seed: result.data.seed,
  };
}

// fallow-ignore-next-line complexity
export async function generateImage(
  opts: GenerateImageOptions,
  deps: GenerateImageDeps
): Promise<GenerateImageResult> {
  requireFalKey(deps);
  const plan = await planGenerateImage(opts, deps);

  for (const disclosure of plan.disclosures) {
    if (disclosure.kind === 'unsupported') {
      deps.warn(`⚠️ ${disclosure.key}: ${disclosure.message}`);
    }
  }

  // Disclose the estimate before the paid call. The lookup itself is already
  // done and is best-effort, so this cannot fail the generation.
  for (const line of formatGenerateImageCost(plan.cost, plan.model)) {
    deps.log(line);
  }

  // Preflight before the paid call: create the parent directory so a
  // successful generation cannot fail on a missing dir.
  await deps.ensureParentDir(plan.outPath);
  const preparedInput = await uploadInputImage(deps, plan.inputTarget);

  const input =
    preparedInput.url === undefined
      ? plan.input
      : { ...plan.input, image_urls: [preparedInput.url] };
  const saved = await generateAndSave(deps, plan.model, input, plan.outPath);
  const costLines = actualCostLines(plan, saved.image);

  await deps.writeJson(
    plan.manifestPath,
    buildManifest({
      platform: plan.platform,
      model: plan.model,
      input,
      inputImage: preparedInput.record,
      requestId: saved.requestId,
      resultSeed: saved.seed,
      requestedSeed: opts.seed,
      outPath: plan.outPath,
      sha256: saved.sha256,
      contentType: saved.image.content_type,
      byteLength: saved.bytes.byteLength,
      generatedAt: deps.now().toISOString(),
      sdkVersion: deps.sdkVersion,
    })
  );

  return {
    outPath: plan.outPath,
    manifestPath: plan.manifestPath,
    sha256: saved.sha256,
    costLines,
  };
}
