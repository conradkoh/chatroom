/**
 * Generate Image Unit Tests
 *
 * Exercises the pure generation logic with injected deps only. No network,
 * no filesystem, no fal SDK import.
 */

import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { FalImageResult, GenerateImageDeps } from './deps.js';
import { generateImage } from './image.js';
import type { GenerateImagePlatform } from './image.js';

const FAL_KEY = 'fal-key-should-never-be-written';
const OUT_PATH = '/tmp/generated/hero.png';
const IMAGE_URL = 'https://fal.test/generated/hero.png';
const IMAGE_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function falResult(overrides: { seed?: number } = {}): FalImageResult {
  return {
    data: {
      images: [{ url: IMAGE_URL, content_type: 'image/png', file_name: 'hero.png' }],
      ...(overrides.seed !== undefined ? { seed: overrides.seed } : {}),
    },
    requestId: 'req-123',
  };
}

function createDeps(overrides: Partial<GenerateImageDeps> = {}): GenerateImageDeps {
  return {
    env: { FAL_KEY },
    falSubscribe: vi.fn().mockResolvedValue(falResult()),
    fetchBytes: vi.fn().mockResolvedValue(IMAGE_BYTES),
    writeFile: vi.fn().mockResolvedValue(undefined),
    writeJson: vi.fn().mockResolvedValue(undefined),
    now: () => new Date('2026-01-02T03:04:05.000Z'),
    sdkVersion: '1.10.1',
    ...overrides,
  };
}

describe('generateImage', () => {
  it('rejects when FAL_KEY is missing and makes no fal call', async () => {
    const deps = createDeps({ env: {} });

    await expect(generateImage({ prompt: 'a hero', out: OUT_PATH }, deps)).rejects.toThrow(
      'FAL_KEY is not set'
    );
    expect(deps.falSubscribe).not.toHaveBeenCalled();
    expect(deps.fetchBytes).not.toHaveBeenCalled();
  });

  it('rejects an empty prompt', async () => {
    const deps = createDeps();

    await expect(generateImage({ prompt: '   ', out: OUT_PATH }, deps)).rejects.toThrow(
      '--prompt must not be empty'
    );
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('rejects an empty out path', async () => {
    const deps = createDeps();

    await expect(generateImage({ prompt: 'a hero', out: '  ' }, deps)).rejects.toThrow(
      '--out must not be empty'
    );
    expect(deps.falSubscribe).not.toHaveBeenCalled();
  });

  it('rejects an unsupported platform before calling fal', async () => {
    const deps = createDeps();

    await expect(
      generateImage(
        { prompt: 'a hero', out: OUT_PATH, platform: 'replicate' as GenerateImagePlatform },
        deps
      )
    ).rejects.toThrow('unsupported platform: replicate');
    expect(deps.falSubscribe).not.toHaveBeenCalled();
    expect(deps.fetchBytes).not.toHaveBeenCalled();
  });

  it('defaults the platform to fal', async () => {
    const deps = createDeps();

    await generateImage({ prompt: 'a castle', out: OUT_PATH }, deps);

    const manifest = (deps.writeJson as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(manifest.platform).toBe('fal');
  });

  it('records an explicitly selected fal platform', async () => {
    const deps = createDeps();

    await generateImage({ prompt: 'a castle', out: OUT_PATH, platform: 'fal' }, deps);

    const manifest = (deps.writeJson as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(manifest.platform).toBe('fal');
  });

  it('rejects when fal returns no image', async () => {
    const deps = createDeps({
      falSubscribe: vi.fn().mockResolvedValue({
        data: { images: [] },
        requestId: 'req-empty',
      }),
    });

    await expect(generateImage({ prompt: 'a hero', out: OUT_PATH }, deps)).rejects.toThrow(
      'fal returned no image for model fal-ai/nano-banana-2'
    );
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('writes the image bytes and a manifest that never contains FAL_KEY', async () => {
    const deps = createDeps();

    const result = await generateImage(
      {
        prompt: 'a knight in a forest',
        out: OUT_PATH,
        model: 'fal-ai/nano-banana-2',
        aspectRatio: '1:1',
        outputFormat: 'png',
        seed: 42,
      },
      deps
    );

    const expectedSha = createHash('sha256').update(IMAGE_BYTES).digest('hex');
    expect(result).toEqual({
      outPath: OUT_PATH,
      manifestPath: `${OUT_PATH}.json`,
      sha256: expectedSha,
    });

    expect(deps.falSubscribe).toHaveBeenCalledWith('fal-ai/nano-banana-2', {
      prompt: 'a knight in a forest',
      aspect_ratio: '1:1',
      output_format: 'png',
      seed: 42,
    });
    expect(deps.writeFile).toHaveBeenCalledWith(OUT_PATH, IMAGE_BYTES);

    const manifest = (deps.writeJson as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(manifest.tool).toBe('chatroom generate-image');
    expect(manifest.sdk).toBe('@fal-ai/client@1.10.1');
    expect(manifest.model).toBe('fal-ai/nano-banana-2');
    expect(manifest.input).toEqual({
      prompt: 'a knight in a forest',
      aspect_ratio: '1:1',
      output_format: 'png',
      seed: 42,
    });
    expect(manifest.requestId).toBe('req-123');
    expect(manifest.seed).toBe(42);
    expect(manifest.output).toEqual({
      path: OUT_PATH,
      sha256: expectedSha,
      contentType: 'image/png',
      bytes: IMAGE_BYTES.byteLength,
    });
    expect(manifest.generatedAt).toBe('2026-01-02T03:04:05.000Z');
    expect(manifest.licensing).toBe('unverified');
    expect(JSON.stringify(manifest).includes(FAL_KEY)).toBe(false);
    expect(deps.writeJson).toHaveBeenCalledWith(`${OUT_PATH}.json`, manifest);
  });

  it('omits seed from input when not provided and defaults the model fields', async () => {
    const deps = createDeps();

    await generateImage({ prompt: 'a castle', out: OUT_PATH }, deps);

    expect(deps.falSubscribe).toHaveBeenCalledWith('fal-ai/nano-banana-2', {
      prompt: 'a castle',
      aspect_ratio: 'auto',
      output_format: 'png',
    });
    const manifest = (deps.writeJson as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(manifest.input).not.toHaveProperty('seed');
    expect(manifest.seed).toBeNull();
  });

  it('prefers the seed echoed back by fal over the requested seed', async () => {
    const deps = createDeps({
      falSubscribe: vi.fn().mockResolvedValue(falResult({ seed: 777 })),
    });

    await generateImage({ prompt: 'a castle', out: OUT_PATH, seed: 42 }, deps);

    const manifest = (deps.writeJson as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(manifest.seed).toBe(777);
  });
});
