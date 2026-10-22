/**
 * Slice Deps — dependency boundary for `chatroom slice-image`.
 *
 * This is the only slice module that imports `pngjs` and `node:fs/promises`.
 * It must not import `./deps.js` at runtime (that module loads the fal SDK);
 * only the `PathStatus` type is shared, so the command stays offline and does
 * not need `FAL_API_KEY`.
 */

// pathStatus and the JSON writers intentionally mirror generate/deps.ts so the
// slice command can reuse the same semantics without importing the fal SDK.
// fallow-ignore-file code-duplication

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';

import pngjs from 'pngjs';

import type { PathStatus } from './deps.js';
import { readInstalledPackageVersion } from './package-version.js';

const { PNG } = pngjs;

/** Decoded image in RGBA 8-bit order, `data.length === width * height * 4`. */
export interface DecodedImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface SliceImageDeps {
  pathStatus: (path: string) => Promise<PathStatus>;
  readFile: (path: string) => Promise<Uint8Array>;
  /** `undefined` when the path is missing; throws when the JSON is invalid. */
  readJsonIfExists: (path: string) => Promise<unknown | undefined>;
  /** Synchronous decode; may throw on malformed input. */
  decodePng: (bytes: Uint8Array) => DecodedImage;
  /** Synchronous, deterministic encode. */
  encodePng: (image: DecodedImage) => Uint8Array;
  /** `mkdir -p`. */
  ensureDir: (dir: string) => Promise<void>;
  writeFile: (path: string, bytes: Uint8Array) => Promise<void>;
  /** `JSON.stringify(value, null, 2)` plus a trailing newline. */
  writeJson: (path: string, value: unknown) => Promise<void>;
  now: () => Date;
  decoderVersion: string;
}

function decodePng(bytes: Uint8Array): DecodedImage {
  const png = PNG.sync.read(Buffer.from(bytes));
  return { width: png.width, height: png.height, data: png.data };
}

/**
 * Fixed pngjs options keep output deterministic for the same input: RGBA,
 * maximum deflate, and pngjs's default adaptive filter selection.
 */
function encodePng(image: DecodedImage): Uint8Array {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data);
  return PNG.sync.write(png, { colorType: 6, deflateLevel: 9, filterType: -1 });
}

/** Classify a path without creating it; anything that is not a dir counts as a file. */
async function pathStatus(path: string): Promise<PathStatus> {
  try {
    const stats = await stat(path);
    return stats.isDirectory() ? 'directory' : 'file';
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return 'missing';
    }
    throw err;
  }
}

async function readJsonIfExists(path: string): Promise<unknown | undefined> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw err;
  }
  return JSON.parse(text) as unknown;
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function writeFileBytes(path: string, bytes: Uint8Array): Promise<void> {
  await writeFile(path, bytes);
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function createDefaultSliceImageDeps(): SliceImageDeps {
  return {
    pathStatus,
    readFile,
    readJsonIfExists,
    decodePng,
    encodePng,
    ensureDir,
    writeFile: writeFileBytes,
    writeJson: writeJsonFile,
    now: () => new Date(),
    decoderVersion: readInstalledPackageVersion('pngjs'),
  };
}
