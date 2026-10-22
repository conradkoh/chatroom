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

import { lstat, mkdir, readFile, stat, writeFile } from 'node:fs/promises';

import pngjs from 'pngjs';

import type { PathStatus } from './deps.js';
import { readInstalledPackageVersion } from './package-version.js';

const { PNG } = pngjs;

/** Options for the two write helpers. `exclusive` uses the `wx` flag. */
export interface WriteOptions {
  exclusive?: boolean | undefined;
}

/** Filesystem identity used to compare paths across case and symlink aliases. */
export interface FileIdentity {
  dev: number;
  ino: number;
}

/** Classify an input path and report its size without opening it. */
export interface InputStat {
  kind: 'file' | 'directory' | 'other' | 'missing';
  size: number;
}

/** Decoded image in RGBA 8-bit order, `data.length === width * height * 4`. */
export interface DecodedImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface SliceImageDeps {
  pathStatus: (path: string) => Promise<PathStatus>;
  /** Classify a path and report its size without opening it. */
  statInput: (path: string) => Promise<InputStat>;
  readFile: (path: string) => Promise<Uint8Array>;
  /** `undefined` when the path is missing; throws when the JSON is invalid. */
  readJsonIfExists: (path: string) => Promise<unknown | undefined>;
  /** Synchronous decode; may throw on malformed input. */
  decodePng: (bytes: Uint8Array) => DecodedImage;
  /** Synchronous, deterministic encode. */
  encodePng: (image: DecodedImage) => Uint8Array;
  /** `mkdir -p`. */
  ensureDir: (dir: string) => Promise<void>;
  writeFile: (path: string, bytes: Uint8Array, options?: WriteOptions) => Promise<void>;
  /** `JSON.stringify(value, null, 2)` plus a trailing newline. */
  writeJson: (path: string, value: unknown, options?: WriteOptions) => Promise<void>;
  /** Identity via `stat` (symlinks resolved); null when the path is missing. */
  fileIdentity: (path: string) => Promise<FileIdentity | null>;
  /** True when the path itself is a symlink, including a dangling one. */
  isSymlink: (path: string) => Promise<boolean>;
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

/** `stat` before reading so FIFOs, devices, and oversized inputs are refused. */
function classifyStat(stats: {
  isDirectory(): boolean;
  isFile(): boolean;
  size: number;
}): InputStat {
  if (stats.isDirectory()) return { kind: 'directory', size: stats.size };
  if (stats.isFile()) return { kind: 'file', size: stats.size };
  return { kind: 'other', size: stats.size };
}

async function statInput(path: string): Promise<InputStat> {
  try {
    return classifyStat(await stat(path));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kind: 'missing', size: 0 };
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

/** `stat` follows symlinks, so two aliases of one file share an identity. */
async function fileIdentity(path: string): Promise<FileIdentity | null> {
  try {
    const stats = await stat(path);
    return { dev: stats.dev, ino: stats.ino };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/** `lstat` does not follow, so a dangling link is still detected. */
async function isSymlink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function writeFileBytes(
  path: string,
  bytes: Uint8Array,
  options: WriteOptions = {}
): Promise<void> {
  if (options.exclusive === true) {
    await writeFile(path, bytes, { flag: 'wx' });
    return;
  }
  await writeFile(path, bytes);
}

async function writeJsonFile(
  path: string,
  value: unknown,
  options: WriteOptions = {}
): Promise<void> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (options.exclusive === true) {
    await writeFile(path, text, { encoding: 'utf8', flag: 'wx' });
    return;
  }
  await writeFile(path, text, 'utf8');
}

export function createDefaultSliceImageDeps(): SliceImageDeps {
  return {
    pathStatus,
    statInput,
    readFile,
    readJsonIfExists,
    decodePng,
    encodePng,
    ensureDir,
    writeFile: writeFileBytes,
    writeJson: writeJsonFile,
    fileIdentity,
    isSymlink,
    now: () => new Date(),
    decoderVersion: readInstalledPackageVersion('pngjs'),
  };
}
