/**
 * Generate Deps — dependency boundary for local asset generation commands.
 *
 * The network, the filesystem, and the clock are all injected so `image.ts`
 * stays pure logic and its unit tests never touch the network or the real
 * disk. `createDefaultGenerateImageDeps` is the only place that knows about
 * `node:fs/promises`; the fal SDK wiring itself lives in `image-shared`, and
 * this file adapts it to the `GenerateImageDeps` shape.
 */

import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { GenerateImageError } from './image.js';
import {
  FalClientError,
  createFalRawSubscribe,
  createFalUploadFile,
} from '../image-shared/fal-client.js';
import {
  createDefaultFalPricingDeps,
  lookupFalUnitPrices,
  type FalUnitPrice,
} from '../image-shared/fal-pricing.js';
import {
  pathStatus,
  writeFileBytes,
  writeJsonFile,
  type PathStatus,
} from '../image-shared/output-files.js';
import { readInstalledPackageVersion } from '../image-shared/package-version.js';

export type { PathStatus } from '../image-shared/output-files.js';

/** The subset of a fal image result the generate command depends on. */
export interface FalImageResult {
  data: {
    images: {
      url: string;
      content_type?: string | undefined;
      file_name?: string | undefined;
      /** Actual output dimensions, when the model reports them. */
      width?: number | undefined;
      height?: number | undefined;
    }[];
    /** Present only for models that echo the resolved seed back. */
    seed?: number | undefined;
  };
  requestId: string;
}

export interface GenerateImageDeps {
  /** Process environment; read for FAL_API_KEY. Never persisted or logged. */
  env: Record<string, string | undefined>;
  /** Queue submit + poll for one model, returning the completed result. */
  falSubscribe: (model: string, input: Record<string, unknown>) => Promise<FalImageResult>;
  /** Download the generated file bytes. */
  fetchBytes: (url: string) => Promise<Uint8Array>;
  /**
   * Read a local file without uploading it. Used only to report an edit input
   * image's dimensions; it never changes the billed quantity.
   */
  readFileBytes: (path: string) => Promise<Uint8Array>;
  /** Look up fal unit prices for the given model ids. Never throws. */
  lookupPrices: (ids: readonly string[]) => Promise<Map<string, FalUnitPrice>>;
  /** Write the image bytes. Parent directories are created by `ensureParentDir`. */
  writeFile: (path: string, bytes: Uint8Array) => Promise<void>;
  /** Write the JSON sidecar manifest. */
  writeJson: (path: string, value: unknown) => Promise<void>;
  /**
   * Upload a local file to fal storage and return its hosted URL. The bytes are
   * sent with the given content type; `contentType` comes from the extension
   * and is never sniffed.
   */
  uploadFile: (path: string, contentType: string) => Promise<string>;
  /** Classify an output path without creating anything. */
  pathStatus: (path: string) => Promise<PathStatus>;
  /** Create the directory that will hold the output, before generation starts. */
  ensureParentDir: (path: string) => Promise<void>;
  now: () => Date;
  /** Installed `@fal-ai/client` version, recorded in the manifest. */
  sdkVersion: string;
  /** Surface a non-fatal warning (for example, extra returned images). */
  warn: (message: string) => void;
  /** Print normal command output, including cost disclosures. */
  log: (message: string) => void;
}

// ─── fal result validation ─────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A malformed result is a fal-side failure, not a user input error. */
function invalidResult(reason: string): GenerateImageError {
  return new GenerateImageError(`fal returned an unexpected result: ${reason}`);
}

function requireRequestId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidResult('requestId is missing');
  }
  return value;
}

function requireImageUrl(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidResult('image entry is missing a url');
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  // fal models may echo optional metadata as null; treat null the same as
  // absent.
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw invalidResult(`${field} is not a string`);
  }
  return value;
}

function requireSeed(value: unknown): number | undefined {
  // Some models report "no seed" as null rather than omitting the field.
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number') {
    throw invalidResult('seed is not a number');
  }
  return value;
}

/** Optional positive pixel dimension; malformed values are treated as absent. */
function optionalDimension(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

// fallow-ignore-next-line complexity
function validateImageFile(value: unknown): FalImageResult['data']['images'][number] {
  if (!isRecord(value)) {
    throw invalidResult('image entry is not an object');
  }
  const content_type = optionalString(value.content_type, 'image content_type');
  const file_name = optionalString(value.file_name, 'image file_name');
  const width = optionalDimension(value.width);
  const height = optionalDimension(value.height);
  return {
    url: requireImageUrl(value.url),
    ...(content_type !== undefined ? { content_type } : {}),
    ...(file_name !== undefined ? { file_name } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };
}

function requireData(value: unknown): FalImageResult['data'] {
  if (!isRecord(value) || !Array.isArray(value.images)) {
    throw invalidResult('data.images is not an array');
  }
  const seed = requireSeed(value.seed);
  return {
    images: value.images.map(validateImageFile),
    ...(seed !== undefined ? { seed } : {}),
  };
}

/**
 * `fal.subscribe` is typed as `any` for a plain string model id, so the result
 * is narrowed at runtime before the rest of the command trusts it.
 */
function validateFalResult(raw: unknown): FalImageResult {
  if (!isRecord(raw)) {
    throw invalidResult('result is not an object');
  }
  return { requestId: requireRequestId(raw.requestId), data: requireData(raw.data) };
}

// ─── fal adapter wrappers ──────────────────────────────────────────────────

/**
 * Translate the shared adapter's failure into this command's error class.
 * Anything else (notably a `validateFalResult` failure) is already a
 * `GenerateImageError` and passes through untouched.
 */
function asGenerateImageError(err: unknown): unknown {
  return err instanceof FalClientError ? new GenerateImageError(err.message) : err;
}

function createFalSubscribe(
  env: Record<string, string | undefined>
): GenerateImageDeps['falSubscribe'] {
  const subscribe = createFalRawSubscribe(env);
  return async (model, input) => {
    try {
      return validateFalResult(await subscribe(model, input));
    } catch (err) {
      throw asGenerateImageError(err);
    }
  };
}

function wrapUploadFile(env: Record<string, string | undefined>): GenerateImageDeps['uploadFile'] {
  const upload = createFalUploadFile(env);
  return async (path, contentType) => {
    try {
      return await upload(path, contentType);
    } catch (err) {
      throw asGenerateImageError(err);
    }
  };
}

// ─── filesystem and download helpers ───────────────────────────────────────

async function ensureParentDir(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

function requireImageContentType(response: Response): void {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('image/')) {
    throw new GenerateImageError(
      `Generated file is not an image (HTTP ${response.status}, content-type: ${contentType || 'missing'})`
    );
  }
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new GenerateImageError(
      `Failed to download generated image (HTTP ${response.status} ${response.statusText})`
    );
  }
  requireImageContentType(response);
  return new Uint8Array(await response.arrayBuffer());
}

export function createDefaultGenerateImageDeps(): GenerateImageDeps {
  const env = process.env;
  const pricingDeps = createDefaultFalPricingDeps(env);
  return {
    env,
    falSubscribe: createFalSubscribe(env),
    uploadFile: wrapUploadFile(env),
    fetchBytes,
    readFileBytes: async (path) => new Uint8Array(await readFile(path)),
    lookupPrices: (ids) => lookupFalUnitPrices(ids, pricingDeps),
    writeFile: writeFileBytes,
    writeJson: writeJsonFile,
    pathStatus,
    ensureParentDir,
    now: () => new Date(),
    sdkVersion: readInstalledPackageVersion('@fal-ai/client'),
    warn: (message) => console.error(message),
    log: (message) => console.log(message),
  };
}
