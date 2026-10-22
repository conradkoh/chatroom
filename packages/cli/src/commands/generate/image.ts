/**
 * Generate Image — pure logic for `chatroom generate-image`.
 *
 * Generates one image through an injected fal subscriber, writes the bytes to
 * `out`, and writes a JSON sidecar manifest to `<out>.json`. No SDK, network,
 * clock, or filesystem access is imported here; all of it arrives through
 * `GenerateImageDeps`, so the unit tests run fully offline.
 */

import { createHash } from 'node:crypto';

import type { FalImageResult, GenerateImageDeps } from './deps.js';

export const DEFAULT_IMAGE_MODEL = 'fal-ai/nano-banana-2';

/**
 * Generation platforms the CLI can call today. New platforms are added here
 * and dispatched in `generateImage`; the flag and manifest field already exist
 * so adding one does not change the command shape.
 */
export const GENERATE_IMAGE_PLATFORMS = ['fal'] as const;
export type GenerateImagePlatform = (typeof GENERATE_IMAGE_PLATFORMS)[number];
export const DEFAULT_GENERATE_IMAGE_PLATFORM: GenerateImagePlatform = 'fal';

export type ImageOutputFormat = 'png' | 'jpeg' | 'webp';

export interface GenerateImageOptions {
  prompt: string;
  out: string;
  platform?: GenerateImagePlatform | undefined;
  model?: string | undefined;
  aspectRatio?: string | undefined;
  outputFormat?: ImageOutputFormat | undefined;
  seed?: number | undefined;
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

const FAL_KEY_MISSING_MESSAGE =
  'FAL_KEY is not set. Set it in your environment to generate images with fal.';

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
  if (!deps.env.FAL_KEY) {
    throw new Error(FAL_KEY_MISSING_MESSAGE);
  }
}

function requireNonEmpty(value: string, message: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(message);
  }
  return trimmed;
}

/**
 * Only send the fields the user actually passed. Model defaults differ (for
 * example some models reject `auto` aspect ratios or have no aspect ratio at
 * all), so the manifest records exactly what went over the wire.
 */
function buildInput(prompt: string, opts: GenerateImageOptions): Record<string, unknown> {
  return {
    prompt,
    ...(opts.aspectRatio !== undefined ? { aspect_ratio: opts.aspectRatio } : {}),
    ...(opts.outputFormat !== undefined ? { output_format: opts.outputFormat } : {}),
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
  };
}

/** The first image of a fal result, or a clear error when the model returned none. */
function requireImage(
  images: FalImageResult['data']['images'],
  model: string
): { url: string; content_type?: string | undefined } {
  const image = images[0];
  if (!image?.url) {
    throw new Error(`fal returned no image for model ${model}`);
  }
  return image;
}

/** Prefer the seed fal resolved; fall back to the requested seed. */
function resolveSeed(
  resultSeed: number | undefined,
  requestedSeed: number | undefined
): number | null {
  return resultSeed ?? requestedSeed ?? null;
}

function buildManifest(args: {
  platform: GenerateImagePlatform;
  model: string;
  input: Record<string, unknown>;
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

export async function generateImage(
  opts: GenerateImageOptions,
  deps: GenerateImageDeps
): Promise<GenerateImageResult> {
  const platform = resolvePlatform(opts.platform);
  // Pure check: reject an unwired platform before touching the environment or network.
  requireSupportedPlatform(platform);

  requireFalKey(deps);

  const prompt = requireNonEmpty(opts.prompt, '--prompt must not be empty.');
  const outPath = requireNonEmpty(opts.out, '--out must not be empty.');
  const model = opts.model ?? DEFAULT_IMAGE_MODEL;
  const input = buildInput(prompt, opts);

  const result = await deps.falSubscribe(model, input);
  const image = requireImage(result.data.images, model);

  const bytes = await deps.fetchBytes(image.url);
  await deps.writeFile(outPath, bytes);

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const manifestPath = `${outPath}.json`;
  await deps.writeJson(
    manifestPath,
    buildManifest({
      platform,
      model,
      input,
      requestId: result.requestId,
      resultSeed: result.data.seed,
      requestedSeed: opts.seed,
      outPath,
      sha256,
      contentType: image.content_type,
      byteLength: bytes.byteLength,
      generatedAt: deps.now().toISOString(),
      sdkVersion: deps.sdkVersion,
    })
  );

  return { outPath, manifestPath, sha256 };
}
