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

export const DEFAULT_IMAGE_MODEL = 'fal-ai/flux-2/flash';
/** Image-to-image edit model used when `--input-image` is set and `--model` is omitted. */
export const DEFAULT_IMAGE_EDIT_MODEL = 'fal-ai/flux-2/flash/edit';
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
  model?: string | undefined;
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

/** Parse `--input` inline JSON and require a plain object. */
// fallow-ignore-next-line complexity
export function parseInputJson(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new GenerateImageError('--input must be valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new GenerateImageError('--input must be a JSON object.');
  }
  const input = parsed as Record<string, unknown>;
  validateInputObject(input);
  return input;
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
  if (opts.input !== undefined) {
    if (typeof opts.input !== 'object' || opts.input === null || Array.isArray(opts.input)) {
      throw new GenerateImageError('--input must be a JSON object.');
    }
    validateInputObject(opts.input);
  }
  return {
    prompt,
    ...(opts.input ?? {}),
    ...(opts.aspectRatio !== undefined ? { aspect_ratio: opts.aspectRatio } : {}),
    ...(opts.outputFormat !== undefined ? { output_format: opts.outputFormat } : {}),
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    ...(imageUrl !== undefined ? { image_urls: [imageUrl] } : {}),
  };
}

/** The first image of a fal result, or a clear error when the model returned none. */
function requireImage(
  images: FalImageResult['data']['images'],
  model: string
): { url: string; content_type?: string | undefined } {
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

/**
 * Resolve `--input-image` into a trimmed value. The edit model sizes output
 * with `image_size`, so `--aspect-ratio` is refused before any file I/O.
 */
function resolveInputImageOption(opts: GenerateImageOptions): string | undefined {
  if (opts.inputImage === undefined) return undefined;
  if (opts.aspectRatio !== undefined) {
    throw new GenerateImageError(
      `--aspect-ratio is not supported with --input-image: ${DEFAULT_IMAGE_EDIT_MODEL} sizes its output with image_size. Pass --input '{"image_size":"landscape_4_3"}' instead.`
    );
  }
  return requireNonEmpty(opts.inputImage, '--input-image must not be empty.');
}

interface PreparedInputImage {
  /** The single value sent to fal in `image_urls`, or undefined without --input-image. */
  url: string | undefined;
  /** What the manifest records for provenance, or null without --input-image. */
  record: { source: string; url: string } | null;
}

/**
 * Preflight the input image before the paid call. A local file is checked and
 * uploaded only after every other check has passed; a public http(s) URL is
 * passed through untouched.
 */
async function prepareInputImage(
  deps: GenerateImageDeps,
  inputImage: string | undefined
): Promise<PreparedInputImage> {
  if (inputImage === undefined) return { url: undefined, record: null };
  if (HTTP_URL_PATTERN.test(inputImage)) {
    return { url: inputImage, record: { source: inputImage, url: inputImage } };
  }
  const localPath = resolve(inputImage);
  // Resolve the content type first so an unsupported extension fails before
  // any bytes are sent.
  const contentType = inputImageContentType(localPath);
  const status = await deps.pathStatus(localPath);
  if (status !== 'file') {
    throw new GenerateImageError(`--input-image is not a file: ${localPath}`);
  }
  const url = await deps.uploadFile(localPath, contentType);
  return { url, record: { source: localPath, url } };
}

/** A completed generation whose bytes are already written to `outPath`. */
interface SavedGeneration {
  image: { url: string; content_type?: string | undefined };
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

export async function generateImage(
  opts: GenerateImageOptions,
  deps: GenerateImageDeps
): Promise<GenerateImageResult> {
  const platform = resolvePlatform(opts.platform);
  // Pure check: reject an unwired platform before touching the environment or network.
  requireSupportedPlatform(platform);

  requireFalKey(deps);

  const prompt = requireNonEmpty(opts.prompt, '--prompt must not be empty.');
  const outPath = resolve(requireNonEmpty(opts.out, '--out must not be empty.'));
  requireSupportedExtension(outPath);
  if (opts.outputFormat !== undefined) {
    requireFormatMatchesExtension(outPath, opts.outputFormat);
  }
  const inputImage = resolveInputImageOption(opts);
  const manifestPath = `${outPath}.json`;

  // Preflight before the paid call: refuse unwritable outputs, then create the
  // parent directory so a successful generation cannot fail on a missing dir.
  await requireWritableOutput(deps, outPath, manifestPath, opts.force === true);
  await deps.ensureParentDir(outPath);

  const preparedInput = await prepareInputImage(deps, inputImage);
  const model =
    opts.model ??
    (preparedInput.url !== undefined ? DEFAULT_IMAGE_EDIT_MODEL : DEFAULT_IMAGE_MODEL);
  const input = buildInput(prompt, opts, preparedInput.url);
  const saved = await generateAndSave(deps, model, input, outPath);

  await deps.writeJson(
    manifestPath,
    buildManifest({
      platform,
      model,
      input,
      inputImage: preparedInput.record,
      requestId: saved.requestId,
      resultSeed: saved.seed,
      requestedSeed: opts.seed,
      outPath,
      sha256: saved.sha256,
      contentType: saved.image.content_type,
      byteLength: saved.bytes.byteLength,
      generatedAt: deps.now().toISOString(),
      sdkVersion: deps.sdkVersion,
    })
  );

  return { outPath, manifestPath, sha256: saved.sha256 };
}
