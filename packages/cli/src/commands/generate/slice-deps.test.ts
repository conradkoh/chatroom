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

import pngjs from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDefaultSliceImageDeps } from './slice-deps.js';
import type { DecodedImage } from './slice-deps.js';
import { sliceImage } from './slice.js';

const { PNG } = pngjs;

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
