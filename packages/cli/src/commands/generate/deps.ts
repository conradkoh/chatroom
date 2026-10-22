/**
 * Generate Deps — dependency boundary for local asset generation commands.
 *
 * The fal SDK, the network, the filesystem, and the clock are all injected so
 * `image.ts` stays pure logic and its unit tests never touch the network or
 * the real disk. `createDefaultGenerateImageDeps` is the only place that knows
 * about `@fal-ai/client` and `node:fs/promises`.
 */

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { fal } from '@fal-ai/client';

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
  /** Process environment; read for FAL_KEY. Never persisted or logged. */
  env: Record<string, string | undefined>;
  /** Queue submit + poll for one model, returning the completed result. */
  falSubscribe: (model: string, input: Record<string, unknown>) => Promise<FalImageResult>;
  /** Download the generated file bytes. */
  fetchBytes: (url: string) => Promise<Uint8Array>;
  /** Write the image bytes; implementations create parent directories. */
  writeFile: (path: string, bytes: Uint8Array) => Promise<void>;
  /** Write the JSON sidecar manifest. */
  writeJson: (path: string, value: unknown) => Promise<void>;
  now: () => Date;
  /** Installed `@fal-ai/client` version, recorded in the manifest. */
  sdkVersion: string;
}

/**
 * Read the installed SDK version from its own package.json.
 *
 * Resolving the entry point (rather than importing `@fal-ai/client/package.json`)
 * works because the package's `exports` map only exposes `.` and `./endpoints`.
 */
function readInstalledSdkVersion(): string {
  const require = createRequire(import.meta.url);
  const entryPath = require.resolve('@fal-ai/client');
  const packageJsonPath = join(dirname(entryPath), '..', 'package.json');
  return (JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string }).version;
}

/**
 * Adapter around the official fal SDK. `fal.subscribe` performs queue submit +
 * poll; the SDK reads FAL_KEY from the environment itself, so the key never
 * passes through this code.
 */
function createFalSubscribe(): GenerateImageDeps['falSubscribe'] {
  return async (model, input) => {
    const result = await fal.subscribe(model, { input, logs: false });
    return result;
  };
}

async function writeFileCreatingParents(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

async function writeJsonCreatingParents(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download generated image (${response.status} ${response.statusText})`
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

export function createDefaultGenerateImageDeps(): GenerateImageDeps {
  return {
    env: process.env,
    falSubscribe: createFalSubscribe(),
    fetchBytes,
    writeFile: writeFileCreatingParents,
    writeJson: writeJsonCreatingParents,
    now: () => new Date(),
    sdkVersion: readInstalledSdkVersion(),
  };
}
