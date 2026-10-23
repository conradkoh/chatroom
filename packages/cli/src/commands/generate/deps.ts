/**
 * Generate Deps — dependency boundary for local asset generation commands.
 *
 * The fal SDK, the network, the filesystem, and the clock are all injected so
 * `image.ts` stays pure logic and its unit tests never touch the network or
 * the real disk. `createDefaultGenerateImageDeps` is the only place that knows
 * about `@fal-ai/client` and `node:fs/promises`.
 */

import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { ApiError, ValidationError, fal } from '@fal-ai/client';

import { pathStatus, writeFileBytes, writeJsonFile, type PathStatus } from './fs-helpers.js';
import { GenerateImageError, FAL_API_KEY_MISSING_MESSAGE } from './image.js';
import { readInstalledPackageVersion } from './package-version.js';

export type { PathStatus } from './fs-helpers.js';

/** The subset of a fal image result the generate command depends on. */
export interface FalImageResult {
  data: {
    images: {
      url: string;
      content_type?: string | undefined;
      file_name?: string | undefined;
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
  /** Write the image bytes. Parent directories are created by `ensureParentDir`. */
  writeFile: (path: string, bytes: Uint8Array) => Promise<void>;
  /** Write the JSON sidecar manifest. */
  writeJson: (path: string, value: unknown) => Promise<void>;
  /** Classify an output path without creating anything. */
  pathStatus: (path: string) => Promise<PathStatus>;
  /** Create the directory that will hold the output, before generation starts. */
  ensureParentDir: (path: string) => Promise<void>;
  now: () => Date;
  /** Installed `@fal-ai/client` version, recorded in the manifest. */
  sdkVersion: string;
  /** Surface a non-fatal warning (for example, extra returned images). */
  warn: (message: string) => void;
}

/** Server-side timeout for the queued generation (the SDK takes seconds). */
const SUBSCRIBE_TIMEOUT_SECONDS = 300;

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
  // fal models may echo optional metadata as null (moss-image does this for
  // file_name), which is equivalent to omitting it.
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

function validateImageFile(value: unknown): FalImageResult['data']['images'][number] {
  if (!isRecord(value)) {
    throw invalidResult('image entry is not an object');
  }
  const content_type = optionalString(value.content_type, 'image content_type');
  const file_name = optionalString(value.file_name, 'image file_name');
  return {
    url: requireImageUrl(value.url),
    ...(content_type !== undefined ? { content_type } : {}),
    ...(file_name !== undefined ? { file_name } : {}),
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

// ─── fal error mapping ─────────────────────────────────────────────────────

function requestSuffix(requestId: string | undefined): string {
  return requestId ? ` [requestId: ${requestId}]` : '';
}

/** Render one `{ loc, msg }` pair, omitting whichever part is absent. */
function formatDetailParts(loc: unknown, msg: unknown): string {
  const location = Array.isArray(loc) ? loc.join('.') : '';
  const message = typeof msg === 'string' ? msg : '';
  return [location, message].filter((part) => part.length > 0).join(': ');
}

function formatDetailList(detail: unknown[]): string | undefined {
  const parts = detail
    .filter(isRecord)
    .map((item) => formatDetailParts(item.loc, item.msg))
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join('; ') : undefined;
}

function formatBodyMessage(message: unknown): string | undefined {
  if (typeof message !== 'string' || message.length === 0) return undefined;
  return message;
}

function formatBodyDetail(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  if (Array.isArray(body.detail)) return formatDetailList(body.detail);
  return formatBodyMessage(body.message);
}

function formatValidationError(err: ValidationError): string {
  const detail = formatDetailList(Array.isArray(err.fieldErrors) ? err.fieldErrors : []);
  return `fal rejected the request (HTTP ${err.status})${detail ? `: ${detail}` : ''}${requestSuffix(err.requestId)}`;
}

function formatApiError(err: ApiError<unknown>): string {
  const detail = formatBodyDetail(err.body);
  return `fal request failed (HTTP ${err.status})${detail ? `: ${detail}` : ''}${requestSuffix(err.requestId)}`;
}

/**
 * fal's 422 bodies carry a `detail[]` list, but `ApiError.message` only holds
 * the status text ("Unprocessable Entity"). Surface the field errors and the
 * request id instead. Headers, and therefore the API key, are never included.
 */
function describeFalError(err: unknown): string {
  if (err instanceof ValidationError) return formatValidationError(err);
  if (err instanceof ApiError) return formatApiError(err);
  return err instanceof Error ? err.message : String(err);
}

/**
 * Adapter around the official fal SDK. `fal.subscribe` performs queue submit +
 * poll. The SDK's built-in credential resolver does not read `FAL_API_KEY`, so
 * the key is passed to `fal.config` explicitly and never logged.
 *
 * The result is returned unvalidated: command-specific validators differ by
 * model shape (`images[]` for text-to-image, `image` for BiRefNet), so each
 * caller narrows the raw result itself.
 */
// fallow-ignore-next-line unused-export
export function createFalRawSubscribe(
  env: Record<string, string | undefined>
): (model: string, input: Record<string, unknown>) => Promise<unknown> {
  return async (model, input) => {
    const credentials = env.FAL_API_KEY;
    if (!credentials) {
      // Defense in depth: image.ts guards first, and this keeps a direct
      // adapter call from silently falling back to the SDK's environment lookup.
      throw new GenerateImageError(FAL_API_KEY_MISSING_MESSAGE);
    }
    fal.config({ credentials });

    try {
      return await fal.subscribe(model, {
        input,
        logs: false,
        startTimeout: SUBSCRIBE_TIMEOUT_SECONDS,
      });
    } catch (err) {
      throw new GenerateImageError(describeFalError(err));
    }
  };
}

/**
 * `generate-image` adapter: raw fal result narrowed to the `images[]` shape.
 */
function createFalSubscribe(
  env: Record<string, string | undefined>
): GenerateImageDeps['falSubscribe'] {
  const subscribe = createFalRawSubscribe(env);
  return async (model, input) => validateFalResult(await subscribe(model, input));
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

// fallow-ignore-next-line unused-export
export async function fetchBytes(url: string): Promise<Uint8Array> {
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
  return {
    env,
    falSubscribe: createFalSubscribe(env),
    fetchBytes,
    writeFile: writeFileBytes,
    writeJson: writeJsonFile,
    pathStatus,
    ensureParentDir,
    now: () => new Date(),
    sdkVersion: readInstalledPackageVersion('@fal-ai/client'),
    warn: (message) => console.error(message),
  };
}
