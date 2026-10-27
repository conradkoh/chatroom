/**
 * Default deps for remove-image-background-fal: the real filesystem adapter and
 * a fal adapter that is constructed but never called here.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type * as FalModule from '@fal-ai/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultRemoveBackgroundFalDeps } from './remove-image-background-fal-deps.js';
import { MAX_FAL_RESULT_BYTES } from './remove-image-background-fal.js';

const { subscribeMock, configMock } = vi.hoisted(() => ({
  subscribeMock: vi.fn(),
  configMock: vi.fn(),
}));

vi.mock('@fal-ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof FalModule>();
  return { ...actual, fal: { ...actual.fal, subscribe: subscribeMock, config: configMock } };
});

const DEPS_KEYS = [
  'env',
  'falSubscribe',
  'fetchBytes',
  'readInput',
  'statInput',
  'pathStatus',
  'writeFile',
  'writeJson',
  'ensureParentDir',
  'now',
  'sdkVersion',
] as const;

describe('createDefaultRemoveBackgroundFalDeps', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'chatroom-remove-bg-fal-deps-'));
    subscribeMock.mockReset();
    configMock.mockReset();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  });

  it('constructs without calling fal', () => {
    const deps = createDefaultRemoveBackgroundFalDeps();

    for (const key of DEPS_KEYS) expect(deps).toHaveProperty(key);
    expect(deps.sdkVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(configMock).not.toHaveBeenCalled();
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it('classifies, reads, and writes through the real filesystem adapter', async () => {
    const deps = createDefaultRemoveBackgroundFalDeps();
    const inputPath = join(dir, 'in.png');
    const outputPath = join(dir, 'nested', 'out.png');
    await writeFile(inputPath, new Uint8Array([1, 2, 3]));

    await expect(deps.pathStatus(inputPath)).resolves.toBe('file');
    await expect(deps.statInput(inputPath)).resolves.toMatchObject({ kind: 'file', size: 3 });
    await expect(deps.readInput(inputPath)).resolves.toBeInstanceOf(Uint8Array);
    expect(Array.from(await deps.readInput(inputPath))).toEqual([1, 2, 3]);

    await deps.ensureParentDir(outputPath);
    await deps.writeFile(outputPath, new Uint8Array([4, 5, 6]));
    await deps.writeJson(`${outputPath}.json`, { ok: true });

    await expect(readFile(outputPath)).resolves.toEqual(Buffer.from([4, 5, 6]));
    await expect(readFile(`${outputPath}.json`, 'utf8')).resolves.toBe('{\n  "ok": true\n}\n');
    expect(deps.now()).toBeInstanceOf(Date);
  });

  it('rejects an oversized content-length before reading the body', async () => {
    const arrayBuffer = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: (name: string) =>
            name === 'content-length' ? String(MAX_FAL_RESULT_BYTES + 1) : 'image/png',
        },
        arrayBuffer,
      })
    );
    const deps = createDefaultRemoveBackgroundFalDeps();

    await expect(deps.fetchBytes('https://fal.test/cutout.png')).rejects.toThrow(
      `maximum is ${MAX_FAL_RESULT_BYTES} bytes (32 MiB)`
    );
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('downloads an image whose content-length is within the cap', async () => {
    const bytes = new Uint8Array([9, 8, 7]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: (name: string) => (name === 'content-length' ? '3' : 'image/png'),
        },
        arrayBuffer: async () => bytes.buffer,
      })
    );
    const deps = createDefaultRemoveBackgroundFalDeps();

    await expect(deps.fetchBytes('https://fal.test/cutout.png')).resolves.toEqual(bytes);
  });
});
