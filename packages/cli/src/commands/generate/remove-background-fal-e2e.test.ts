/**
 * `chatroom remove-image-background-fal` end-to-end tests.
 *
 * Runs the registered commander command against the real filesystem in a
 * temporary directory, with fake fal subscribe and download dependencies. No
 * network call and no paid fal call is made.
 */

import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import pngjs from 'pngjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerRemoveImageBackgroundFalCommand } from './remove-background-fal-command.js';
import type { RemoveBackgroundFalDeps } from './remove-background-fal.js';
import { listUnitPrices } from '../generate-image/fal-pricing.js';
import { createDefaultSliceImageDeps } from '../slice-image/slice-deps.js';

const { PNG } = pngjs;

const { depsHolder } = vi.hoisted(() => ({ depsHolder: { current: undefined as unknown } }));

vi.mock('@fal-ai/client', () => {
  throw new Error('must not load fal');
});

vi.mock('./remove-background-fal-deps.js', () => ({
  createDefaultRemoveBackgroundFalDeps: () => depsHolder.current,
}));

const FAL_API_KEY = 'fal-key-sentinel-never-printed';
const IMAGE_URL = 'https://fal.test/cutout.png';

function buildPng(width: number, height: number, alpha: number): Uint8Array {
  const image = new PNG({ width, height });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data.set([30, 60, 90, alpha], offset);
  }
  return PNG.sync.write(image, { colorType: 6, deflateLevel: 9 });
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function buildDeps(
  download: Uint8Array,
  falSubscribe?: RemoveBackgroundFalDeps['falSubscribe']
): RemoveBackgroundFalDeps {
  const slice = createDefaultSliceImageDeps();
  return {
    env: { FAL_API_KEY },
    falSubscribe:
      falSubscribe ??
      (async () => ({
        requestId: 'req-e2e',
        data: { image: { url: IMAGE_URL } },
      })),
    lookupPrices: async (ids: readonly string[]) => listUnitPrices(ids),
    fetchBytes: async () => download,
    readInput: slice.readFile,
    statInput: slice.statInput,
    pathStatus: slice.pathStatus,
    writeFile: slice.writeFile,
    writeJson: slice.writeJson,
    ensureParentDir: (path) => slice.ensureDir(dirname(path)),
    now: () => new Date('2026-10-23T04:05:06.000Z'),
    sdkVersion: '1.10.1',
    log: (message) => console.log(message),
  };
}

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerRemoveImageBackgroundFalCommand(program);
  return program;
}

function run(args: string[]): Promise<unknown> {
  return createProgram().parseAsync(['node', 'chatroom', 'remove-image-background-fal', ...args]);
}

describe('chatroom remove-image-background-fal (end-to-end)', () => {
  let dir: string;
  let inputPath: string;
  let outputPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'chatroom-remove-bg-fal-e2e-'));
    inputPath = join(dir, 'potion.png');
    outputPath = join(dir, 'assets', 'potion.png');
    await writeFile(inputPath, buildPng(6, 5, 255));
    depsHolder.current = buildDeps(buildPng(6, 5, 200));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the bria cut-out and a manifest that keeps provenance but not the key', async () => {
    const download = buildPng(6, 5, 200);
    const falSubscribe = vi.fn(async () => ({
      requestId: 'req-e2e',
      data: { image: { url: IMAGE_URL } },
    }));
    depsHolder.current = buildDeps(download, falSubscribe);
    const source = await readFile(inputPath);

    await run(['--in', inputPath, '--out', outputPath]);

    expect(process.exitCode).toBeUndefined();
    expect(await readFile(outputPath)).toEqual(Buffer.from(download));

    const dataUri = `data:image/png;base64,${Buffer.from(source).toString('base64')}`;
    expect(falSubscribe).toHaveBeenCalledWith('fal-ai/bria/background/remove', {
      image_url: dataUri,
    });

    const manifestText = await readFile(`${outputPath}.json`, 'utf8');
    const manifest = JSON.parse(manifestText) as {
      platform: string;
      tool: string;
      sdk: string;
      engine: string;
      model: string;
      input: Record<string, unknown>;
      requestId: string;
      output: Record<string, unknown>;
      generatedAt: string;
      licensing: string;
    };
    expect(manifest).toMatchObject({
      platform: 'fal',
      tool: 'chatroom remove-image-background-fal',
      sdk: '@fal-ai/client@1.10.1',
      engine: 'bria',
      model: 'fal-ai/bria/background/remove',
      input: {
        source: 'potion.png',
        sourceBytes: source.byteLength,
        sourceSha256: sha256(source),
        width: 6,
        height: 5,
      },
      requestId: 'req-e2e',
      output: {
        path: outputPath,
        sha256: sha256(download),
        bytes: download.byteLength,
        contentType: 'image/png',
        width: 6,
        height: 5,
      },
      generatedAt: '2026-10-23T04:05:06.000Z',
      licensing: 'unverified',
    });
    expect(manifest.input.mode).toBeUndefined();
    expect(manifest.input.output_format).toBeUndefined();
    expect(manifestText.includes(FAL_API_KEY)).toBe(false);
    expect(manifestText.includes('data:image/png;base64,')).toBe(false);
    expect(manifestText.includes(IMAGE_URL)).toBe(false);

    const output = vi
      .mocked(console.log)
      .mock.calls.map((call) => String(call[0]))
      .join('\n');
    expect(output).toContain(`Removed background ${outputPath}`);
    expect(output).toContain(`Manifest ${outputPath}.json`);
    expect(output).toContain('Request req-e2e');
    expect(output).toContain('Cost (estimate): $0.01800 per generation');
    expect(output).toContain('Estimated cost: $0.01800 per generation');
    expect(output).toContain('fal returns no billed cost');
  });

  it('runs the previous BiRefNet Matting backend with --engine birefnet', async () => {
    const source = await readFile(inputPath);
    const falSubscribe = vi.fn(async () => ({
      requestId: 'req-birefnet',
      data: { image: { url: IMAGE_URL } },
    }));
    depsHolder.current = buildDeps(buildPng(6, 5, 200), falSubscribe);

    await run(['--in', inputPath, '--out', outputPath, '--engine', 'birefnet']);

    expect(process.exitCode).toBeUndefined();
    const dataUri = `data:image/png;base64,${Buffer.from(source).toString('base64')}`;
    expect(falSubscribe).toHaveBeenCalledWith('fal-ai/birefnet/v2', {
      image_url: dataUri,
      model: 'Matting',
      output_format: 'png',
    });

    const manifest = JSON.parse(await readFile(`${outputPath}.json`, 'utf8')) as {
      engine: string;
      model: string;
      input: Record<string, unknown>;
      requestId: string;
    };
    expect(manifest).toMatchObject({
      engine: 'birefnet',
      model: 'fal-ai/birefnet/v2',
      input: { mode: 'Matting', output_format: 'png' },
      requestId: 'req-birefnet',
    });
  });

  it('refuses a second run without --force and overwrites with --force', async () => {
    const falSubscribe = vi.fn(async () => ({
      requestId: 'req-e2e',
      data: { image: { url: IMAGE_URL } },
    }));
    depsHolder.current = buildDeps(buildPng(6, 5, 200), falSubscribe);
    await run(['--in', inputPath, '--out', outputPath]);
    expect(falSubscribe).toHaveBeenCalledTimes(1);
    vi.mocked(console.error).mockClear();
    process.exitCode = undefined;

    await run(['--in', inputPath, '--out', outputPath]);

    expect(process.exitCode).toBe(1);
    expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).toContain('already exists');
    // The refused run never reaches the paid call.
    expect(falSubscribe).toHaveBeenCalledTimes(1);

    process.exitCode = undefined;
    await run(['--in', inputPath, '--out', outputPath, '--force']);
    expect(process.exitCode).toBeUndefined();
    expect(falSubscribe).toHaveBeenCalledTimes(2);
    expect(await readFile(outputPath)).toEqual(Buffer.from(buildPng(6, 5, 200)));
  });

  it('refuses to overwrite an existing manifest without --force', async () => {
    await run(['--in', inputPath, '--out', outputPath]);
    // Remove only the PNG; the leftover manifest must still block the next run.
    await rm(outputPath);
    const falSubscribe = vi.fn(async () => ({
      requestId: 'req-e2e',
      data: { image: { url: IMAGE_URL } },
    }));
    depsHolder.current = buildDeps(buildPng(6, 5, 200), falSubscribe);
    vi.mocked(console.error).mockClear();
    process.exitCode = undefined;

    await run(['--in', inputPath, '--out', outputPath]);

    expect(process.exitCode).toBe(1);
    expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).toContain(
      'Manifest already exists'
    );
    expect(falSubscribe).not.toHaveBeenCalled();
    await expect(readFile(outputPath)).rejects.toThrow();
  });

  it('rejects a resized result without writing the PNG or manifest', async () => {
    depsHolder.current = buildDeps(buildPng(7, 5, 200));

    await run(['--in', inputPath, '--out', outputPath]);

    expect(process.exitCode).toBe(1);
    const message = String(vi.mocked(console.error).mock.calls[0]?.[0]);
    expect(message).toContain('result is 7x5');
    expect(message).toContain('input is 6x5');
    expect(message).toContain('--engine birefnet');
    await expect(readFile(outputPath)).rejects.toThrow();
    await expect(readFile(`${outputPath}.json`)).rejects.toThrow();
  });

  it('refuses a non-PNG input before calling fal', async () => {
    const falSubscribe = vi.fn();
    const deps = buildDeps(buildPng(6, 5, 200));
    deps.falSubscribe = falSubscribe;
    depsHolder.current = deps;
    await writeFile(inputPath, 'not a png');

    await run(['--in', inputPath, '--out', outputPath]);

    expect(process.exitCode).toBe(1);
    expect(falSubscribe).not.toHaveBeenCalled();
    expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).toContain('is not a PNG');
  });
});
