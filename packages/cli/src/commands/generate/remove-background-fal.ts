/**
 * `chatroom remove-image-background-fal` orchestration.
 *
 * Sends one PNG to fal's BiRefNet model as a base64 data URI and writes the
 * returned PNG (with alpha) plus a JSON manifest. This is the online sibling of
 * the local colour-key `remove-image-background` command; it never shares that
 * command's code so the local pass stays fal-free.
 *
 * Every dependency (SDK, network, filesystem, clock) is injected, so the unit
 * tests run offline and no paid call is made without a real `FAL_API_KEY`.
 */

import { basename, resolve } from 'node:path';

import type { PathStatus } from './fs-helpers.js';
import { FAL_API_KEY_MISSING_MESSAGE } from './image.js';
import {
  MAX_SOURCE_PIXELS,
  hasPngMagic,
  isRecord,
  readPngDimensions,
  sha256,
} from './local-image-common.js';

// fallow-ignore-next-line unused-export
export const FAL_BACKGROUND_MODEL = 'fal-ai/birefnet/v2' as const;
// fallow-ignore-next-line unused-export
export const FAL_BACKGROUND_MODE = 'Matting' as const;
/** Base64 input is ~4/3 of bytes; keep the request body well under fal limits. */
// fallow-ignore-next-line unused-export
export const MAX_FAL_INPUT_BYTES = 8 * 1024 * 1024;
// fallow-ignore-next-line unused-export
export const MAX_FAL_RESULT_BYTES = 32 * 1024 * 1024;

const TOOL = 'chatroom remove-image-background-fal' as const;

/**
 * fal's terms do not expressly grant commercial rights to outputs, so every
 * manifest records `unverified` until a human confirms the licence.
 */
const LICENSING = 'unverified' as const;

class RemoveBackgroundFalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RemoveBackgroundFalError';
  }
}

export interface RemoveBackgroundFalOptions {
  in: string;
  out: string;
  force?: boolean | undefined;
}

export interface RemoveBackgroundFalDeps {
  /** Process environment; read for FAL_API_KEY. Never persisted or logged. */
  env: Record<string, string | undefined>;
  /** Raw fal queue submit + poll. The result is narrowed by this module. */
  falSubscribe: (model: string, input: Record<string, unknown>) => Promise<unknown>;
  /** Download the returned PNG. */
  fetchBytes: (url: string) => Promise<Uint8Array>;
  /** Read the source PNG; the caller checks the size first. */
  readInput: (path: string) => Promise<Uint8Array>;
  statInput: (path: string) => Promise<{ size: number }>;
  pathStatus: (path: string) => Promise<PathStatus>;
  writeFile: (path: string, bytes: Uint8Array) => Promise<void>;
  writeJson: (path: string, value: unknown) => Promise<void>;
  /** `mkdir -p` for the directory holding the output path. */
  ensureParentDir: (path: string) => Promise<void>;
  now: () => Date;
  /** Installed `@fal-ai/client` version, recorded in the manifest. */
  sdkVersion: string;
}

export interface RemoveBackgroundFalResult {
  outPath: string;
  manifestPath: string;
  requestId: string;
  bytes: number;
  sha256: string;
}

/** The subset of a BiRefNet result this command depends on. */
export interface FalBackgroundResult {
  requestId: string;
  data: { image: { url: string } };
}

/**
 * BiRefNet returns a single `data.image` object, unlike text-to-image models
 * that return `data.images[]`. Any other shape is treated as a fal-side
 * failure, and the message matches the generate-image wording.
 */
// fallow-ignore-next-line unused-export complexity
export function validateBackgroundResult(raw: unknown): FalBackgroundResult {
  const unexpected = new RemoveBackgroundFalError(
    `fal returned no image for ${FAL_BACKGROUND_MODEL}`
  );
  if (!isRecord(raw)) throw unexpected;
  const { requestId, data } = raw;
  if (typeof requestId !== 'string' || requestId.length === 0) throw unexpected;
  if (!isRecord(data) || !isRecord(data.image)) throw unexpected;
  const { url } = data.image;
  if (typeof url !== 'string' || !url.startsWith('https://')) throw unexpected;
  return { requestId, data: { image: { url } } };
}

/** Reject a source before the paid call: missing, non-file, oversized, or non-PNG. */
// fallow-ignore-next-line complexity
async function requireSource(path: string, deps: RemoveBackgroundFalDeps): Promise<Uint8Array> {
  const status = await deps.pathStatus(path);
  if (status === 'missing') throw new RemoveBackgroundFalError(`Input not found: ${path}`);
  if (status !== 'file') {
    throw new RemoveBackgroundFalError(`Input is not a regular file: ${path}`);
  }
  const stats = await deps.statInput(path);
  if (stats.size > MAX_FAL_INPUT_BYTES) {
    throw new RemoveBackgroundFalError(
      `${path} is ${stats.size} bytes; the maximum fal input is ${MAX_FAL_INPUT_BYTES} bytes (8 MiB).`
    );
  }
  const bytes = await deps.readInput(path);
  // The file may have grown between stat and read; the request body must stay bounded.
  if (bytes.byteLength > MAX_FAL_INPUT_BYTES) {
    throw new RemoveBackgroundFalError(
      `${path} is ${bytes.byteLength} bytes; the maximum fal input is ${MAX_FAL_INPUT_BYTES} bytes (8 MiB).`
    );
  }
  if (!hasPngMagic(bytes)) throw new RemoveBackgroundFalError(`${path} is not a PNG.`);
  const dimensions = readPngDimensions(bytes);
  if (dimensions === null || dimensions.width === 0 || dimensions.height === 0) {
    throw new RemoveBackgroundFalError(`Could not decode ${path}: missing or invalid IHDR.`);
  }
  if (dimensions.width * dimensions.height > MAX_SOURCE_PIXELS) {
    throw new RemoveBackgroundFalError(
      `${path} is ${dimensions.width}x${dimensions.height}; the maximum is ${MAX_SOURCE_PIXELS} pixels.`
    );
  }
  return bytes;
}

/** Refuse to clobber an existing file unless the user asked with --force. */
async function requireWritableOutput(
  path: string,
  force: boolean,
  deps: RemoveBackgroundFalDeps
): Promise<void> {
  const status = await deps.pathStatus(path);
  if (status === 'directory') {
    throw new RemoveBackgroundFalError(`--out is a directory: ${path}. Pass a file path.`);
  }
  if (status === 'file' && !force) {
    throw new RemoveBackgroundFalError(
      `Output already exists: ${path}. Pass --force to overwrite.`
    );
  }
}

/** Failures after the paid call still name the request id so the result can be recovered. */
function recoveryMessage(action: string, err: unknown, requestId: string, url: string): string {
  const detail = err instanceof Error ? err.message : String(err);
  return `Failed to ${action} image for request ${requestId} (${url}): ${detail}. The result can still be recovered from that URL.`;
}

/**
 * Cut the subject out of one PNG with fal BiRefNet and write the alpha PNG.
 *
 * Stage order is the safety contract: the key, input, and output are all
 * validated before the paid call, and nothing is written until the downloaded
 * bytes are within the size cap and are actually a PNG.
 */
// fallow-ignore-next-line complexity
export async function removeBackgroundFal(
  options: RemoveBackgroundFalOptions,
  deps: RemoveBackgroundFalDeps
): Promise<RemoveBackgroundFalResult> {
  if (!deps.env.FAL_API_KEY) {
    // Same wording as generate-image so the setup instructions stay one story.
    throw new RemoveBackgroundFalError(FAL_API_KEY_MISSING_MESSAGE);
  }

  const inPath = resolve(options.in);
  const outPath = resolve(options.out);
  const source = await requireSource(inPath, deps);
  await requireWritableOutput(outPath, options.force === true, deps);

  // Strings pass through the SDK unchanged, so the data URI is the request body.
  const dataUri = `data:image/png;base64,${Buffer.from(source).toString('base64')}`;
  const raw = await deps.falSubscribe(FAL_BACKGROUND_MODEL, {
    image_url: dataUri,
    model: FAL_BACKGROUND_MODE,
    output_format: 'png',
  });
  const result = validateBackgroundResult(raw);
  const imageUrl = result.data.image.url;

  let bytes: Uint8Array;
  try {
    bytes = await deps.fetchBytes(imageUrl);
  } catch (err) {
    throw new RemoveBackgroundFalError(
      recoveryMessage('download', err, result.requestId, imageUrl)
    );
  }
  if (bytes.byteLength > MAX_FAL_RESULT_BYTES) {
    throw new RemoveBackgroundFalError(
      `Downloaded image is ${bytes.byteLength} bytes; the maximum is ${MAX_FAL_RESULT_BYTES} bytes (32 MiB).`
    );
  }
  if (!hasPngMagic(bytes)) {
    throw new RemoveBackgroundFalError(
      `Downloaded file is not a PNG (request ${result.requestId}, ${imageUrl}).`
    );
  }

  const manifestPath = `${outPath}.json`;
  const outputSha256 = sha256(bytes);
  const manifest = {
    platform: 'fal' as const,
    tool: TOOL,
    sdk: `@fal-ai/client@${deps.sdkVersion}`,
    model: FAL_BACKGROUND_MODEL,
    input: {
      mode: FAL_BACKGROUND_MODE,
      output_format: 'png',
      source: basename(inPath),
      sourceBytes: source.byteLength,
      sourceSha256: sha256(source),
    },
    requestId: result.requestId,
    output: {
      path: outPath,
      sha256: outputSha256,
      bytes: bytes.byteLength,
      contentType: 'image/png',
    },
    generatedAt: deps.now().toISOString(),
    licensing: LICENSING,
  };

  try {
    await deps.ensureParentDir(outPath);
    await deps.writeFile(outPath, bytes);
  } catch (err) {
    throw new RemoveBackgroundFalError(recoveryMessage('save', err, result.requestId, imageUrl));
  }
  await deps.writeJson(manifestPath, manifest);

  return {
    outPath,
    manifestPath,
    requestId: result.requestId,
    bytes: bytes.byteLength,
    sha256: outputSha256,
  };
}
