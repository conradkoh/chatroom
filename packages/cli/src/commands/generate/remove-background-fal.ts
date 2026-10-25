/**
 * `chatroom remove-image-background-fal` orchestration.
 *
 * Sends one PNG to a fal background-removal model as a base64 data URI and
 * writes the returned PNG (with alpha) plus a JSON manifest. `bria` is the
 * default; `birefnet` keeps the previous BiRefNet Matting path available. This
 * is the online sibling of the local colour-key `remove-image-background`
 * command; it never shares that command's code so the local pass stays fal-free.
 *
 * Every dependency (SDK, network, filesystem, clock) is injected, so the unit
 * tests run offline and no paid call is made without a real `FAL_API_KEY`.
 */

import { basename, resolve } from 'node:path';

import {
  formatCostDisclosure,
  LIST_PRICES,
  type FalCostDisclosure,
  type FalUnitPrice,
} from './fal-pricing.js';
import type { PathStatus } from './fs-helpers.js';
import { FAL_API_KEY_MISSING_MESSAGE } from './image.js';
import {
  MAX_SOURCE_PIXELS,
  hasPngMagic,
  isRecord,
  readPngDimensions,
  sha256,
} from './local-image-common.js';

export type BackgroundEngine = 'bria' | 'birefnet';
export const DEFAULT_BACKGROUND_ENGINE: BackgroundEngine = 'bria';

interface EngineSpec {
  readonly model: string;
  buildInput(imageDataUri: string): Record<string, unknown>;
}

/**
 * Engine table. `buildInput` is the only engine-specific request shape:
 * BiRefNet needs its Matting mode and PNG output, while Bria's background
 * removal returns PNG with alpha from `image_url` alone.
 */
// fallow-ignore-next-line unused-export
export const BACKGROUND_ENGINES: Record<BackgroundEngine, EngineSpec> = {
  bria: {
    model: 'fal-ai/bria/background/remove',
    buildInput: (image_url) => ({ image_url }),
  },
  birefnet: {
    model: 'fal-ai/birefnet/v2',
    buildInput: (image_url) => ({ image_url, model: 'Matting', output_format: 'png' }),
  },
};

/** Base64 input is ~4/3 of bytes; keep the request body well under fal limits. */
// fallow-ignore-next-line unused-export
export const MAX_FAL_INPUT_BYTES = 8 * 1024 * 1024;
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
  /** Background-removal backend; defaults to `DEFAULT_BACKGROUND_ENGINE`. */
  engine?: BackgroundEngine | undefined;
  force?: boolean | undefined;
}

export interface RemoveBackgroundFalDeps {
  /** Process environment; read for FAL_API_KEY. Never persisted or logged. */
  env: Record<string, string | undefined>;
  /** Raw fal queue submit + poll. The result is narrowed by this module. */
  falSubscribe: (model: string, input: Record<string, unknown>) => Promise<unknown>;
  /** Look up fal unit prices for the given model ids. Never throws in production. */
  lookupPrices: (ids: readonly string[]) => Promise<Map<string, FalUnitPrice>>;
  /** Download the returned PNG with an early size cap. */
  fetchBytes: (url: string) => Promise<Uint8Array>;
  /** Read the source PNG; the caller checks the size first. */
  readInput: (path: string) => Promise<Uint8Array>;
  /** Classify an input path and report its size without opening it. */
  statInput: (path: string) => Promise<InputStat>;
  pathStatus: (path: string) => Promise<PathStatus>;
  writeFile: (path: string, bytes: Uint8Array) => Promise<void>;
  writeJson: (path: string, value: unknown) => Promise<void>;
  /** `mkdir -p` for the directory holding the output path. */
  ensureParentDir: (path: string) => Promise<void>;
  now: () => Date;
  /** Installed `@fal-ai/client` version, recorded in the manifest. */
  sdkVersion: string;
  /** Print normal command output, including cost disclosures. */
  log: (message: string) => void;
}

/** Input classification; `other` covers FIFOs, devices, and sockets. */
export interface InputStat {
  kind: 'file' | 'directory' | 'other' | 'missing';
  size: number;
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
 * Both engines return a single `data.image` object, unlike text-to-image models
 * that return `data.images[]`. Any other shape is treated as a fal-side
 * failure, and the message matches the generate-image wording.
 */
// fallow-ignore-next-line unused-export complexity
export function validateBackgroundResult(raw: unknown, model: string): FalBackgroundResult {
  const unexpected = new RemoveBackgroundFalError(`fal returned no image for ${model}`);
  if (!isRecord(raw)) throw unexpected;
  const { requestId, data } = raw;
  if (typeof requestId !== 'string' || requestId.length === 0) throw unexpected;
  if (!isRecord(data) || !isRecord(data.image)) throw unexpected;
  const { url } = data.image;
  if (typeof url !== 'string' || !url.startsWith('https://')) throw unexpected;
  return { requestId, data: { image: { url } } };
}

/** Reject a source before the paid call: missing, non-regular, oversized, or non-PNG. */
// fallow-ignore-next-line complexity
async function requireSource(
  path: string,
  deps: RemoveBackgroundFalDeps
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  // `stat` classifies the path, so a FIFO or device is refused before any read.
  const stats = await deps.statInput(path);
  if (stats.kind === 'missing') throw new RemoveBackgroundFalError(`Input not found: ${path}`);
  if (stats.kind === 'directory') {
    throw new RemoveBackgroundFalError(`Input is a directory: ${path}. Pass a PNG file path.`);
  }
  if (stats.kind !== 'file') {
    throw new RemoveBackgroundFalError(`Input is not a regular file: ${path}.`);
  }
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
  return { bytes, width: dimensions.width, height: dimensions.height };
}

/**
 * A tile sheet that comes back at a different size would shift every tile's grid
 * position, so a mismatched result is rejected before anything is written.
 * `--engine birefnet` is the escape hatch when an engine insists on resizing.
 */
function requireMatchingDimensions(args: {
  bytes: Uint8Array;
  input: { width: number; height: number };
  requestId: string;
  imageUrl: string;
  outPath: string;
}): { width: number; height: number } {
  const result = readPngDimensions(args.bytes);
  const recovery = `The result can still be recovered from that URL.`;
  const hint = `Re-run with --engine birefnet, or resize the sheet so the engine accepts it.`;
  if (result === null) {
    throw new RemoveBackgroundFalError(
      `Failed to use image for request ${args.requestId} (${args.imageUrl}): could not read the result PNG dimensions; the input is ${args.input.width}x${args.input.height} and ${args.outPath} was not written. ${hint} ${recovery}`
    );
  }
  if (result.width !== args.input.width || result.height !== args.input.height) {
    throw new RemoveBackgroundFalError(
      `Failed to use image for request ${args.requestId} (${args.imageUrl}): result is ${result.width}x${result.height}, but the input is ${args.input.width}x${args.input.height}; ${args.outPath} was not written. ${hint} ${recovery}`
    );
  }
  return result;
}

/**
 * Refuse to clobber an existing file unless the user asked with --force.
 * A directory is always a conflict, even with --force.
 */
async function requireWritablePath(
  path: string,
  label: string,
  force: boolean,
  deps: RemoveBackgroundFalDeps
): Promise<void> {
  const status = await deps.pathStatus(path);
  if (status === 'directory') {
    throw new RemoveBackgroundFalError(`${label} is a directory: ${path}. Pass a file path.`);
  }
  if (status === 'file' && !force) {
    throw new RemoveBackgroundFalError(
      `${label} already exists: ${path}. Pass --force to overwrite.`
    );
  }
}

/** Both outputs are preflighted before the paid call, as in generate-image. */
async function requireWritableOutputs(
  outPath: string,
  manifestPath: string,
  force: boolean,
  deps: RemoveBackgroundFalDeps
): Promise<void> {
  await requireWritablePath(outPath, '--out', force, deps);
  await requireWritablePath(manifestPath, 'Manifest', force, deps);
}

/** A manifest write failure happens after the paid call, so name the request id. */
function manifestSaveMessage(
  err: unknown,
  requestId: string,
  outPath: string,
  manifestPath: string
): string {
  const detail = err instanceof Error ? err.message : String(err);
  return `Failed to save manifest ${manifestPath} for request ${requestId} (output ${outPath}): ${detail}. The image was written but its manifest is missing.`;
}

/** Failures after the paid call still name the request id so the result can be recovered. */
function recoveryMessage(action: string, err: unknown, requestId: string, url: string): string {
  const detail = err instanceof Error ? err.message : String(err);
  return `Failed to ${action} image for request ${requestId} (${url}): ${detail}. The result can still be recovered from that URL.`;
}

/** What the CLI knows about one background-removal call's cost. */
interface BackgroundCost {
  model: string;
  engine: BackgroundEngine;
  price: FalUnitPrice | undefined;
}

const FAL_BILL_NOTE = 'fal returns no billed cost; check the fal dashboard for the actual bill.';
const BIFNET_RATE_REASON = 'total depends on runtime; not estimated.';

/**
 * Look up the engine's rate, falling back to the list price if the injected
 * lookup fails. Never throws: a pricing failure must not block the generation.
 */
async function findBackgroundPrice(
  deps: RemoveBackgroundFalDeps,
  model: string
): Promise<FalUnitPrice | undefined> {
  try {
    const price = (await deps.lookupPrices([model])).get(model);
    if (price !== undefined) return price;
  } catch {
    // Fall through to the list price; a pricing failure is not a command failure.
  }
  const fallback = LIST_PRICES[model];
  return fallback === undefined
    ? undefined
    : { endpointId: model, ...fallback, rateSource: 'list' };
}

/** Bria is flat per generation; BiRefNet's runtime total is not estimated. */
function backgroundCostDisclosure(cost: BackgroundCost): FalCostDisclosure {
  if (cost.price === undefined) return { kind: 'unknown', model: cost.model };
  if (cost.engine === 'birefnet') {
    return {
      kind: 'rate-only',
      model: cost.model,
      price: cost.price,
      reason: BIFNET_RATE_REASON,
    };
  }
  return {
    kind: 'estimate',
    model: cost.model,
    price: cost.price,
    quantity: 1,
    quantityLabel: '1 generation',
  };
}

function formatBackgroundCost(cost: BackgroundCost, label: 'Cost' | 'Estimated cost'): string[] {
  const line = formatCostDisclosure(backgroundCostDisclosure(cost), label);
  return cost.price === undefined ? [line] : [line, FAL_BILL_NOTE];
}

/**
 * Cut the subject out of one PNG with the selected fal engine and write the
 * alpha PNG.
 *
 * Stage order is the safety contract: the key, input, output, and manifest are
 * all validated before the paid call, and nothing is written until the
 * downloaded bytes are within the size cap, are actually a PNG, and match the
 * input dimensions.
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

  const engine = options.engine ?? DEFAULT_BACKGROUND_ENGINE;
  const spec = BACKGROUND_ENGINES[engine];
  const inPath = resolve(options.in);
  const outPath = resolve(options.out);
  const manifestPath = `${outPath}.json`;
  if (inPath === outPath) {
    throw new RemoveBackgroundFalError(
      `--in and --out are the same file: ${inPath}. Choose a different output path.`
    );
  }
  const source = await requireSource(inPath, deps);
  await requireWritableOutputs(outPath, manifestPath, options.force === true, deps);

  const cost: BackgroundCost = {
    model: spec.model,
    engine,
    price: await findBackgroundPrice(deps, spec.model),
  };
  for (const line of formatBackgroundCost(cost, 'Cost')) deps.log(line);

  // Strings pass through the SDK unchanged, so the data URI is the request body.
  const dataUri = `data:image/png;base64,${Buffer.from(source.bytes).toString('base64')}`;
  const raw = await deps.falSubscribe(spec.model, spec.buildInput(dataUri));
  const result = validateBackgroundResult(raw, spec.model);
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
  const outputDimensions = requireMatchingDimensions({
    bytes,
    input: source,
    requestId: result.requestId,
    imageUrl,
    outPath,
  });

  const outputSha256 = sha256(bytes);
  const manifest = {
    platform: 'fal' as const,
    tool: TOOL,
    sdk: `@fal-ai/client@${deps.sdkVersion}`,
    engine,
    model: spec.model,
    input: {
      // BiRefNet's mode and explicit PNG output are part of the request; Bria
      // takes only `image_url`, which the manifest never records.
      ...(engine === 'birefnet' ? { mode: 'Matting' as const, output_format: 'png' as const } : {}),
      source: basename(inPath),
      sourceBytes: source.bytes.byteLength,
      sourceSha256: sha256(source.bytes),
      width: source.width,
      height: source.height,
    },
    requestId: result.requestId,
    output: {
      path: outPath,
      sha256: outputSha256,
      bytes: bytes.byteLength,
      contentType: 'image/png',
      width: outputDimensions.width,
      height: outputDimensions.height,
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
  try {
    await deps.writeJson(manifestPath, manifest);
  } catch (err) {
    throw new RemoveBackgroundFalError(
      manifestSaveMessage(err, result.requestId, outPath, manifestPath)
    );
  }

  for (const line of formatBackgroundCost(cost, 'Estimated cost')) deps.log(line);

  return {
    outPath,
    manifestPath,
    requestId: result.requestId,
    bytes: bytes.byteLength,
    sha256: outputSha256,
  };
}
