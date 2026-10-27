/**
 * Slice Deps — dependency boundary for `chatroom slice-image`.
 *
 * This is the only slice module that imports `pngjs`. It must not import
 * `./deps.js` at runtime (that module loads the fal SDK); filesystem helpers
 * come from the fal-free `output-files.js`, so the command stays offline and
 * does not need `FAL_API_KEY`.
 */

import { lstat, mkdir, readFile, stat } from 'node:fs/promises';

import pngjs from 'pngjs';

import {
  pathStatus,
  writeFileBytes,
  writeJsonFile,
  type PathStatus,
  type WriteOptions,
} from '../image-shared/output-files.js';
import { readInstalledPackageVersion } from '../image-shared/package-version.js';

const { PNG } = pngjs;

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
