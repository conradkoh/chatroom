/**
 * Slice Deps Unit Tests
 *
 * Exercises the real pngjs adapter against a temporary directory. No network
 * and no mocked codec: this proves RGB/RGBA decoding, deterministic encoding,
 * and the filesystem helper semantics used by slice-image.
 */

import { link, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

import pngjs from 'pngjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultSliceImageDeps } from './slice-deps.js';
import type { DecodedImage } from './slice-deps.js';
import { sliceImage } from './slice.js';

// The real adapter (and the command path that uses it) must never load fal.
vi.mock('@fal-ai/client', () => {
  throw new Error('must not load fal');
});

const { PNG } = pngjs;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), out.length - 4);
  return out;
}

/** Build a PNG with arbitrary IHDR fields, chunks, and scanline data. */
function buildRawPng(args: {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  raw: Buffer;
  interlace?: boolean;
  extraChunks?: Buffer[];
}): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(args.width, 0);
  ihdr.writeUInt32BE(args.height, 4);
  ihdr[8] = args.bitDepth;
  ihdr[9] = args.colorType;
  if (args.interlace === true) ihdr[12] = 1;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    ...(args.extraChunks ?? []),
    chunk('IDAT', deflateSync(args.raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function pixel(x: number, y: number): number[] {
  return [x * 100, y * 100, 50, 255];
}

function image(
  width: number,
  height: number,
  pixel: (x: number, y: number) => number[]
): DecodedImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set(pixel(x, y), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected the call to reject');
}

describe('createDefaultSliceImageDeps', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'chatroom-slice-deps-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips RGBA pixels through encode and decode', () => {
    const deps = createDefaultSliceImageDeps();
    const source = image(3, 2, (x, y) => [x * 10, y * 20, 128, 255]);

    const decoded = deps.decodePng(deps.encodePng(source));

    expect(decoded.width).toBe(3);
    expect(decoded.height).toBe(2);
    expect(Array.from(decoded.data)).toEqual(Array.from(source.data));
  });

  it('decodes an RGB PNG into RGBA with opaque alpha', () => {
    const deps = createDefaultSliceImageDeps();
    const rgba = image(2, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 255, 0, 255]));
    const png = new PNG({ width: 2, height: 1, colorType: 2 });
    png.data = Buffer.from(rgba.data);
    const rgbBytes = PNG.sync.write(png, { colorType: 2 });

    const decoded = deps.decodePng(rgbBytes);

    expect(decoded.data).toHaveLength(2 * 4);
    expect(Array.from(decoded.data)).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });

  it('rescales 16-bit RGBA to 8-bit RGBA', () => {
    const deps = createDefaultSliceImageDeps();
    const values = new Uint16Array([65535, 0, 0, 65535, 0, 65535, 0, 32768]);
    const png = new PNG({ width: 2, height: 1 });
    png.data = Buffer.from(values.buffer);
    const bytes = PNG.sync.write(png, {
      bitDepth: 16,
      colorType: 6,
      inputColorType: 6,
      inputHasAlpha: true,
    });

    const decoded = deps.decodePng(bytes);

    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(1);
    expect(decoded.data).toHaveLength(2 * 4);
    expect(Array.from(decoded.data)).toEqual([255, 0, 0, 255, 0, 255, 0, 128]);
  });

  it('rescales 16-bit RGB to 8-bit RGBA', () => {
    const deps = createDefaultSliceImageDeps();
    const values = new Uint16Array([65535, 0, 0, 0, 65535, 0]);
    const png = new PNG({ width: 2, height: 1 });
    png.data = Buffer.from(values.buffer);
    const bytes = PNG.sync.write(png, {
      bitDepth: 16,
      colorType: 2,
      inputColorType: 2,
      inputHasAlpha: false,
    });

    const decoded = deps.decodePng(bytes);

    expect(decoded.data).toHaveLength(2 * 4);
    expect(Array.from(decoded.data)).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });

  it('decodes greyscale (colorType 0) to RGBA', () => {
    const deps = createDefaultSliceImageDeps();
    const rgba = image(2, 1, (x) => (x === 0 ? [100, 100, 100, 255] : [200, 200, 200, 255]));
    const png = new PNG({ width: 2, height: 1, colorType: 0 });
    png.data = Buffer.from(rgba.data);
    const bytes = PNG.sync.write(png, { colorType: 0, inputColorType: 6, inputHasAlpha: true });

    const decoded = deps.decodePng(bytes);

    expect(decoded.data).toHaveLength(2 * 4);
    expect(Array.from(decoded.data)).toEqual([100, 100, 100, 255, 200, 200, 200, 255]);
  });

  it('decodes greyscale+alpha (colorType 4) to RGBA', () => {
    const deps = createDefaultSliceImageDeps();
    const rgba = image(2, 1, (x) => (x === 0 ? [60, 60, 60, 255] : [120, 120, 120, 128]));
    const png = new PNG({ width: 2, height: 1, colorType: 4 });
    png.data = Buffer.from(rgba.data);
    const bytes = PNG.sync.write(png, { colorType: 4, inputColorType: 6, inputHasAlpha: true });

    const decoded = deps.decodePng(bytes);

    expect(decoded.data).toHaveLength(2 * 4);
    expect(Array.from(decoded.data)).toEqual([60, 60, 60, 255, 120, 120, 120, 128]);
  });

  it('decodes a palette PNG with tRNS alpha', () => {
    const deps = createDefaultSliceImageDeps();
    const palette = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]);
    const transparency = Buffer.from([255, 255, 128]);
    const raw = Buffer.from([
      0,
      0,
      1, // row 0: filter, index 0, index 1
      0,
      2,
      0, // row 1: filter, index 2, index 0
    ]);
    const bytes = buildRawPng({
      width: 2,
      height: 2,
      bitDepth: 8,
      colorType: 3,
      raw,
      extraChunks: [chunk('PLTE', palette), chunk('tRNS', transparency)],
    });

    const decoded = deps.decodePng(bytes);

    expect(decoded.data).toHaveLength(2 * 2 * 4);
    expect(Array.from(decoded.data)).toEqual([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 128, 255, 0, 0, 255,
    ]);
  });

  it('decodes an interlaced 8-bit RGBA PNG', () => {
    const deps = createDefaultSliceImageDeps();
    const raw = Buffer.concat([
      Buffer.from([0]), // pass 1 filter
      Buffer.from(pixel(0, 0)),
      Buffer.from([0]), // pass 6 filter
      Buffer.from(pixel(1, 0)),
      Buffer.from([0]), // pass 7 filter
      Buffer.from(pixel(0, 1)),
      Buffer.from(pixel(1, 1)),
    ]);
    const bytes = buildRawPng({
      width: 2,
      height: 2,
      bitDepth: 8,
      colorType: 6,
      interlace: true,
      raw,
    });

    const decoded = deps.decodePng(bytes);

    expect(decoded.data).toHaveLength(2 * 2 * 4);
    expect(Array.from(decoded.data)).toEqual([
      ...pixel(0, 0),
      ...pixel(1, 0),
      ...pixel(0, 1),
      ...pixel(1, 1),
    ]);
  });

  it('preserves alpha from an RGBA PNG', () => {
    const deps = createDefaultSliceImageDeps();
    const source = image(1, 1, () => [1, 2, 3, 0]);

    const decoded = deps.decodePng(deps.encodePng(source));

    expect(Array.from(decoded.data)).toEqual([1, 2, 3, 0]);
  });

  it('throws when decoding garbage', () => {
    const deps = createDefaultSliceImageDeps();

    expect(() => deps.decodePng(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });

  it('encodes deterministically', () => {
    const deps = createDefaultSliceImageDeps();
    const source = image(4, 4, (x, y) => [x, y, x + y, 255]);

    const first = deps.encodePng(source);
    const second = deps.encodePng(source);

    expect(Array.from(first)).toEqual(Array.from(second));
  });

  it('reads missing JSON as undefined and throws on invalid JSON', async () => {
    const deps = createDefaultSliceImageDeps();
    const missing = join(dir, 'missing.json');
    const invalid = join(dir, 'invalid.json');
    await writeFile(invalid, '{ not json', 'utf8');

    await expect(deps.readJsonIfExists(missing)).resolves.toBeUndefined();
    await expect(captureError(deps.readJsonIfExists(invalid))).resolves.toBeInstanceOf(Error);
  });

  it('classifies missing, file, and directory paths', async () => {
    const deps = createDefaultSliceImageDeps();
    const filePath = join(dir, 'file.txt');
    await writeFile(filePath, 'x', 'utf8');

    await expect(deps.pathStatus(join(dir, 'nope'))).resolves.toBe('missing');
    await expect(deps.pathStatus(filePath)).resolves.toBe('file');
    await expect(deps.pathStatus(dir)).resolves.toBe('directory');
  });

  it('stats inputs by kind and size without reading them', async () => {
    const deps = createDefaultSliceImageDeps();
    const filePath = join(dir, 'file.txt');
    await writeFile(filePath, 'hello', 'utf8');

    await expect(deps.statInput(filePath)).resolves.toEqual({ kind: 'file', size: 5 });
    await expect(deps.statInput(dir)).resolves.toMatchObject({ kind: 'directory' });
    await expect(deps.statInput(join(dir, 'nope'))).resolves.toEqual({
      kind: 'missing',
      size: 0,
    });
  });

  it('creates nested directories', async () => {
    const deps = createDefaultSliceImageDeps();
    const nested = join(dir, 'a', 'b', 'c');

    await deps.ensureDir(nested);

    await expect(deps.pathStatus(nested)).resolves.toBe('directory');
  });

  it('writes JSON with a trailing newline', async () => {
    const deps = createDefaultSliceImageDeps();
    const path = join(dir, 'manifest.json');

    await deps.writeJson(path, { a: 1 });

    await expect(readFile(path, 'utf8')).resolves.toBe('{\n  "a": 1\n}\n');
  });

  it('writes exact bytes', async () => {
    const deps = createDefaultSliceImageDeps();
    const path = join(dir, 'bytes.bin');
    const bytes = new Uint8Array([9, 8, 7]);

    await deps.writeFile(path, bytes);

    expect(Array.from(await readFile(path))).toEqual([9, 8, 7]);
  });

  it('refuses an exclusive write to an existing file', async () => {
    const deps = createDefaultSliceImageDeps();
    const path = join(dir, 'existing.bin');
    await writeFile(path, 'old');

    const error = await captureError(
      deps.writeFile(path, new Uint8Array([1]), { exclusive: true })
    );

    expect((error as NodeJS.ErrnoException).code).toBe('EEXIST');
    await expect(readFile(path, 'utf8')).resolves.toBe('old');
  });

  it('identifies aliases of the same file and detects symlinks', async () => {
    const deps = createDefaultSliceImageDeps();
    const target = join(dir, 'target.txt');
    const hardLink = join(dir, 'hard.txt');
    const symbolicLink = join(dir, 'soft.txt');
    await writeFile(target, 'same bytes');
    await link(target, hardLink);
    await symlink(target, symbolicLink);

    const targetIdentity = await deps.fileIdentity(target);
    expect(targetIdentity).not.toBeNull();
    await expect(deps.fileIdentity(hardLink)).resolves.toEqual(targetIdentity);
    await expect(deps.fileIdentity(symbolicLink)).resolves.toEqual(targetIdentity);
    await expect(deps.fileIdentity(join(dir, 'missing'))).resolves.toBeNull();

    await expect(deps.isSymlink(symbolicLink)).resolves.toBe(true);
    await expect(deps.isSymlink(target)).resolves.toBe(false);
    await expect(deps.isSymlink(join(dir, 'missing'))).resolves.toBe(false);
  });

  it('detects a dangling symlink as a symlink', async () => {
    const deps = createDefaultSliceImageDeps();
    const dangling = join(dir, 'dangling.txt');
    await symlink(join(dir, 'does-not-exist.txt'), dangling);

    await expect(deps.isSymlink(dangling)).resolves.toBe(true);
    await expect(deps.fileIdentity(dangling)).resolves.toBeNull();
  });

  it('refuses a symlink named as an output', async () => {
    const deps = createDefaultSliceImageDeps();
    const sheetPath = join(dir, 'sheet.png');
    const outDir = join(dir, 'out');
    await writeFile(sheetPath, deps.encodePng(image(2, 2, () => [1, 2, 3, 255])));
    await mkdir(outDir);
    await symlink(join(dir, 'elsewhere.png'), join(outDir, 'tile.png'));

    const error = await captureError(
      sliceImage({ in: sheetPath, outDir, cols: 1, rows: 1, names: ['tile'], force: true }, deps)
    );

    expect(error.message).toContain('this is a symbolic link');
  });

  it('refuses a dangling symlink named as an output', async () => {
    const deps = createDefaultSliceImageDeps();
    const sheetPath = join(dir, 'sheet.png');
    const outDir = join(dir, 'out');
    await writeFile(sheetPath, deps.encodePng(image(2, 2, () => [1, 2, 3, 255])));
    await mkdir(outDir);
    await symlink(join(dir, 'missing-target.png'), join(outDir, 'tile.png'));

    const error = await captureError(
      sliceImage({ in: sheetPath, outDir, cols: 1, rows: 1, names: ['tile'], force: true }, deps)
    );

    expect(error.message).toContain('this is a symbolic link');
  });

  it('reports the installed pngjs version', () => {
    const deps = createDefaultSliceImageDeps();

    expect(deps.decoderVersion).not.toBe('unknown');
    expect(deps.decoderVersion).toMatch(/^\d+\.\d+\.\d+/);
  });
});
