/**
 * Generate 3D Deps — dependency boundary for `chatroom generate-3d`.
 *
 * The fal SDK, the network, the filesystem, and the clock are injected so
 * `generate-3d.ts` stays pure logic and its unit tests never touch the network
 * or the real disk. `createDefaultGenerate3dDeps` is the only place that knows
 * about `@fal-ai/client` and `node:fs/promises`.
 */

import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { Generate3dError } from './model-registry.js';
import { createWebVariant, type WebVariant, type WebVariantOptions } from './web-variant.js';
import { zipPackage, type ZipEntry } from './zip-package.js';
import { createFalRawSubscribe, createFalUploadFile } from '../generate-image/deps.js';
import {
  pathStatus,
  writeFileBytes,
  writeJsonFile,
  type PathStatus,
} from '../image-shared/output-files.js';
import { readInstalledPackageVersion } from '../image-shared/package-version.js';

/** The subset of a fal 3D result the command depends on before adaptation. */
export interface Generate3dFalResult {
  requestId: string;
  /** Model-specific payload; each registry spec narrows it itself. */
  data: unknown;
}

export interface Generate3dDeps {
  /** Process environment; read for FAL_API_KEY. Never persisted or logged. */
  env: Record<string, string | undefined>;
  /** Queue submit + poll for one model, returning the completed raw result. */
  falSubscribe(model: string, input: Record<string, unknown>): Promise<Generate3dFalResult>;
  /** Download the generated GLB bytes and verify the GLB magic. */
  fetchGlb(url: string): Promise<Uint8Array>;
  /**
   * Upload a local input image to fal storage and return its hosted URL. The
   * bytes are sent with the given content type; `contentType` comes from the
   * extension and is never sniffed.
   */
  uploadFile(path: string, contentType: string): Promise<string>;
  /** Write the GLB bytes. Parent directories are created by `ensureParentDir`. */
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  /** Write the JSON sidecar manifest. */
  writeJson(path: string, value: unknown): Promise<void>;
  /** Classify an output path without creating anything. */
  pathStatus(path: string): Promise<PathStatus>;
  /** Create the directory that will hold the output, before generation starts. */
  ensureParentDir(path: string): Promise<void>;
  /**
   * Build the web variant of the master GLB. Loads `@gltf-transform/functions`
   * and `sharp` on first use, so a run that never packages pays nothing.
   */
  createWebVariant(glb: Uint8Array, opts: WebVariantOptions): Promise<WebVariant>;
  /** Build the deterministic package zip from its entries. */
  zipPackage(entries: readonly ZipEntry[]): Uint8Array;
  now(): Date;
  /** Installed `@fal-ai/client` version, recorded in the manifest. */
  sdkVersion: string;
}

// ─── fal result validation ─────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A malformed result is a fal-side failure, not a user input error. */
function invalidResult(reason: string): Generate3dError {
  return new Generate3dError(`fal returned an unexpected result: ${reason}`);
}

function requireRequestId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidResult('requestId is missing');
  }
  return value;
}

function requireDataObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw invalidResult('data is not an object');
  return value;
}

/**
 * Validate the fal result envelope before any model-specific adapter runs.
 * `fal.subscribe` is typed as `any` for a plain string model id.
 */
function validateFalResult(raw: unknown): Generate3dFalResult {
  if (!isRecord(raw)) throw invalidResult('result is not an object');
  return {
    requestId: requireRequestId(raw.requestId),
    data: requireDataObject(raw.data),
  };
}

// ─── GLB download ──────────────────────────────────────────────────────────

/** GLB magic ("glTF", little-endian 0x46546C67) at the start of every GLB file. */
const GLB_MAGIC = [0x67, 0x6c, 0x54, 0x46] as const;

function hasGlbMagic(bytes: Uint8Array): boolean {
  return GLB_MAGIC.every((byte, index) => bytes[index] === byte);
}

/**
 * Download the GLB and reject HTML error pages. The content type is not
 * trusted: fal's file hosts sometimes return `application/octet-stream`, so
 * the four-byte magic is the real check.
 */
async function fetchGlb(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Generate3dError(
      `Failed to download generated GLB (HTTP ${response.status} ${response.statusText})`
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!hasGlbMagic(bytes)) {
    throw new Generate3dError(
      'Downloaded model is not a GLB (missing glTF magic); an error page was returned instead.'
    );
  }
  return bytes;
}

export function createDefaultGenerate3dDeps(): Generate3dDeps {
  const env = process.env;
  const subscribe = createFalRawSubscribe(env);
  return {
    env,
    falSubscribe: async (model, input) => validateFalResult(await subscribe(model, input)),
    fetchGlb,
    uploadFile: createFalUploadFile(env),
    writeFile: writeFileBytes,
    writeJson: writeJsonFile,
    pathStatus,
    ensureParentDir: async (path) => {
      await mkdir(dirname(path), { recursive: true });
    },
    createWebVariant,
    zipPackage,
    now: () => new Date(),
    sdkVersion: readInstalledPackageVersion('@fal-ai/client'),
  };
}
